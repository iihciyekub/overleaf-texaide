'use strict';

const {
  WOS_FIELD_REFERENCES,
  translationInstructions,
  COMPOSITION_INSTRUCTIONS,
  REVIEW_INSTRUCTIONS,
  INTENT_SCHEMA,
  COMPOSITION_SCHEMA,
  REVIEW_SCHEMA
} = require('./wos-query-prompts');
const {
  presetFor,
  requestCompletion
} = require('./ai-provider-client');
const { conversationContextText } = require('./llm-context-manager');

function normalizeInput(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonObjects(text) {
  const objects = [];
  let start = null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== null) {
        objects.push(text.slice(start, index + 1));
        start = null;
      }
    }
  }
  return objects;
}

function decodeJSON(text, type) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidates = [cleaned, ...jsonObjects(cleaned).reverse()];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      // Try the next extracted JSON object.
    }
  }
  throw new Error(`${type || 'The model'} returned no usable structured result.`);
}

function normalizeName(value, field) {
  const fieldName = String(field || '').toUpperCase();
  if (!['OG', 'SO'].includes(fieldName)) {
    return value;
  }
  return String(value || '').replace(/(?<![A-Za-z0-9])and(?![A-Za-z0-9])/gi, '&');
}

function normalizeQuotedNames(value) {
  const quotedLiteralPattern = /"(?:\\.|[^"\\])*"/g;
  return String(value || '').replace(quotedLiteralPattern, literal => {
    const inner = literal.slice(1, -1);
    return `"${normalizeName(inner, 'OG')}"`;
  });
}

function fieldExpressions(query, fields) {
  const pattern = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,5})\s*=\s*\(/g;
  const expressions = [];
  let match;
  while ((match = pattern.exec(query)) !== null) {
    const field = match[1].toUpperCase();
    if (!fields.has(field)) {
      continue;
    }

    let index = match.index + match[0].length;
    const valueStart = index;
    let depth = 1;
    let inQuote = false;
    let escaped = false;
    while (index < query.length) {
      const character = query[index];
      if (character === '"' && !escaped) {
        inQuote = !inQuote;
      } else if (!inQuote) {
        if (character === '(') {
          depth += 1;
        } else if (character === ')') {
          depth -= 1;
          if (depth === 0) {
            expressions.push({
              field,
              valueStart,
              valueEnd: index
            });
            break;
          }
        }
      }
      escaped = character === '\\' && !escaped;
      if (character !== '\\') {
        escaped = false;
      }
      index += 1;
    }
  }
  return expressions;
}

function isInsideQuotes(text, index) {
  let inside = false;
  let escaped = false;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const character = text[cursor];
    if (character === '"' && !escaped) {
      inside = !inside;
    }
    escaped = character === '\\' && !escaped;
    if (character !== '\\') {
      escaped = false;
    }
  }
  return inside;
}

function escapedQueryLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function protectProperNames(query, literals) {
  let protectedQuery = query;
  const fields = new Set(literals.map(literal => literal.field));
  const expressions = fieldExpressions(protectedQuery, fields).reverse();

  for (const expression of expressions) {
    let value = protectedQuery.slice(expression.valueStart, expression.valueEnd);
    const matchingLiterals = literals
      .filter(literal => literal.field === expression.field)
      .sort((a, b) => Math.max(b.term.length, b.normalizedTerm.length) - Math.max(a.term.length, a.normalizedTerm.length));

    for (const literal of matchingLiterals) {
      for (const term of Array.from(new Set([literal.term, literal.normalizedTerm]))) {
        const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`, 'gi');
        let match;
        const replacements = [];
        while ((match = pattern.exec(value)) !== null) {
          if (!isInsideQuotes(value, match.index)) {
            replacements.push({ start: match.index, end: match.index + match[0].length });
          }
        }
        for (const replacement of replacements.reverse()) {
          value = value.slice(0, replacement.start) + literal.quotedValue + value.slice(replacement.end);
        }
      }
    }

    protectedQuery = protectedQuery.slice(0, expression.valueStart)
      + value
      + protectedQuery.slice(expression.valueEnd);
  }

  return protectedQuery;
}

function normalizeProperNameFieldValues(query) {
  let normalizedQuery = query;
  const expressions = fieldExpressions(normalizedQuery, new Set(['OG', 'SO'])).reverse();
  for (const expression of expressions) {
    const value = normalizedQuery.slice(expression.valueStart, expression.valueEnd);
    normalizedQuery = normalizedQuery.slice(0, expression.valueStart)
      + normalizeQuotedNames(value)
      + normalizedQuery.slice(expression.valueEnd);
  }
  return normalizedQuery;
}

function queryDeduplicationKey(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*([=(),])\s*/g, '$1');
}

function organizationResolutions(intent) {
  return (intent.concepts || [])
    .filter(concept => concept.required && String(concept.suggestedField || '').trim().toUpperCase() === 'OG')
    .map(concept => ({
      conceptID: concept.id,
      requestedTerms: concept.englishTerms || [],
      status: 'unverified',
      preferredName: null,
      source: 'unavailable'
    }));
}

function protectedProperNameLiterals(intent, resolutions) {
  const resolutionsByConceptID = new Map(resolutions.map(resolution => [resolution.conceptID, resolution]));
  const seen = new Set();
  const literals = [];

  for (const concept of intent.concepts || []) {
    if (!concept.required) {
      continue;
    }
    const field = String(concept.suggestedField || '').trim().toUpperCase();
    if (!['OG', 'OO', 'AD', 'SO'].includes(field)) {
      continue;
    }

    const resolvedName = String(resolutionsByConceptID.get(concept.id)?.preferredName || '').trim();
    const terms = resolvedName ? [resolvedName] : (concept.englishTerms || []);
    for (const rawTerm of terms) {
      const term = String(rawTerm || '').trim();
      if (!term) {
        continue;
      }
      const normalizedFieldValue = normalizeName(term, field);
      const key = `${field}\u0000${normalizedFieldValue.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      literals.push({
        field,
        term,
        normalizedTerm: normalizedFieldValue,
        quotedValue: `"${escapedQueryLiteral(normalizedFieldValue)}"`
      });
    }
  }

  return literals;
}

function organizationResolutionIssues(query, resolutions) {
  const issues = [];
  for (const resolution of resolutions) {
    issues.push({
      id: `organization.unverified.${resolution.conceptID}`,
      severity: 'warning',
      message: 'The institution name is syntactically valid but has not been verified against a Web of Science Organization-Enhanced data source.'
    });
  }
  return issues;
}

function validateCandidate(query, intent) {
  const issues = [];
  const normalized = String(query || '').trim();
  if (!normalized) {
    return {
      isValid: false,
      issues: [{
        id: 'query.empty',
        severity: 'error',
        message: 'The query is empty.'
      }]
    };
  }

  const requiredFields = new Set(
    (intent.concepts || [])
      .filter(concept => concept.required)
      .map(concept => String(concept.suggestedField || '').trim().toUpperCase())
  );

  for (const field of requiredFields) {
    if (!['OG', 'SO'].includes(field)) {
      continue;
    }
    const expressionPattern = new RegExp(`(?<![A-Za-z0-9])${field}\\s*=\\s*\\(`, 'i');
    if (!expressionPattern.test(normalized)) {
      issues.push({
        id: `requiredField.missing.${field}`,
        severity: 'error',
        message: `The query is missing the required ${field} field.`
      });
    }
  }

  for (const concept of intent.concepts || []) {
    if (!concept.required) {
      continue;
    }
    const field = String(concept.suggestedField || '').trim().toUpperCase();
    if (
      field === 'OG'
      && !/(?<![A-Za-z0-9])OG\s*=\s*\(/i.test(normalized)
      && /(?<![A-Za-z0-9])TS\s*=\s*\(/i.test(normalized)
    ) {
      issues.push({
        id: `organization.tsPrimary.${concept.id}`,
        severity: 'error',
        message: 'The institution is searched only through TS; use OG as the primary affiliation field.'
      });
    }
  }

  return {
    isValid: !issues.some(issue => issue.severity === 'error'),
    issues
  };
}

function appendIssues(report, extraIssues) {
  return {
    isValid: report.isValid && !extraIssues.some(issue => issue.severity === 'error'),
    issues: [...(report.issues || []), ...extraIssues]
  };
}

function completionRequest(schemaName, instructions, input, schema, maxOutputTokens) {
  return {
    schemaName,
    instructions,
    input,
    schema,
    maxOutputTokens
  };
}

async function completeAndDecode(config, request, type, onModelCall, signal) {
  let lastError = null;
  let invalidResponse = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted?.();
    let activeRequest = request;
    if (attempt > 0) {
      activeRequest = {
        ...request,
        input: `${request.input}

The previous provider response did not match the required shape.
Repair the response below. Preserve its valid meaning, return
every required property, remove undeclared properties, and
validate the result against this full JSON Schema before answering.

Previous invalid response:
${invalidResponse}

Required JSON Schema:
${request.schema}`
      };
    }

    try {
      const result = await requestCompletion(config, activeRequest, { signal });
      if (onModelCall) {
        onModelCall({ usage: result.usage, succeeded: true });
      }
      try {
        return decodeJSON(result.text, type);
      } catch (decodeError) {
        invalidResponse = result.text;
        throw decodeError;
      }
    } catch (error) {
      if (onModelCall) {
        onModelCall({ usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, succeeded: false });
      }
      lastError = error;
      if (attempt === 0 && /no usable structured result/i.test(error.message)) {
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

function sumUsage(usages) {
  return usages.reduce((total, usage) => ({
    inputTokens: total.inputTokens + (usage.inputTokens || 0),
    cachedInputTokens: total.cachedInputTokens + (usage.cachedInputTokens || 0),
    outputTokens: total.outputTokens + (usage.outputTokens || 0)
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
}

async function runWosQueryPipeline(input, config, options = {}) {
  const localeIdentifier = options.localeIdentifier || 'English';
  const onStageChange = options.onStageChange || (async () => {});
  const onModelCall = options.onModelCall || (() => {});
  const signal = options.signal;
  const priorConversation = conversationContextText(options.conversationContext);
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0
  };
  const reportModelCall = observation => {
    usage.inputTokens += Number(observation?.usage?.inputTokens || 0);
    usage.cachedInputTokens += Number(observation?.usage?.cachedInputTokens || 0);
    usage.outputTokens += Number(observation?.usage?.outputTokens || 0);
    onModelCall(observation);
  };
  const normalized = normalizeInput(input);
  if (!normalized) {
    throw new Error('Enter a research question before asking the assistant.');
  }

  const preset = presetFor(config.presetId || config.kind || 'compatible');
  const resolvedConfig = {
    ...preset,
    ...config,
    kind: config.kind || preset.kind,
    transport: config.transport || preset.transport,
    structuredOutput: config.structuredOutput || preset.structuredOutput
  };

  await onStageChange('translating');
  const intentRequest = completionRequest(
    'wos_research_intent',
    translationInstructions(localeIdentifier),
    `${priorConversation ? `Prior conversation context:
${priorConversation}

Use the prior context only to resolve follow-up references and preserve confirmed constraints.
The current request has priority when it changes an earlier decision.

` : ''}Researcher's current natural-language request:
${normalized}

Return JSON only.`,
    INTENT_SCHEMA,
    2000
  );
  const intent = await completeAndDecode(resolvedConfig, intentRequest, 'research intent', reportModelCall, signal);
  const resolutions = organizationResolutions(intent);

  await onStageChange('composing');
  const intentJSON = JSON.stringify(intent, null, 2);
  const resolutionJSON = JSON.stringify(resolutions, null, 2);
  const protectedLiterals = protectedProperNameLiterals(intent, resolutions);
  const protectedLiteralJSON = JSON.stringify(protectedLiterals, null, 2);

  const compositionRequest = completionRequest(
    'wos_query_candidates',
    COMPOSITION_INSTRUCTIONS,
    `Confirmed research intent:
${intentJSON}

Organization-Enhanced name resolution:
${resolutionJSON}

Protected proper-name literals:
${protectedLiteralJSON}

Return JSON only.`,
    COMPOSITION_SCHEMA,
    3000
  );
  const composition = await completeAndDecode(resolvedConfig, compositionRequest, 'query candidates', reportModelCall, signal);

  const protectedDrafts = (composition.candidates || []).map(draft => ({
    id: draft.id,
    label: draft.label,
    query: normalizeProperNameFieldValues(protectProperNames(draft.query, protectedLiterals))
  }));

  const seenCandidateIDs = new Set();
  const seenDraftQueries = new Set();
  const candidateDrafts = protectedDrafts.filter(candidate => {
    const id = String(candidate.id || '').trim();
    const queryKey = queryDeduplicationKey(candidate.query);
    return id
      && queryKey
      && !seenCandidateIDs.has(id)
      && !seenDraftQueries.has(queryKey)
      && (seenCandidateIDs.add(id), seenDraftQueries.add(queryKey), true);
  });

  if (!candidateDrafts.length) {
    throw new Error('The model did not return any query candidates.');
  }

  await onStageChange('validating');
  const diagnostics = candidateDrafts.map(candidate => {
    const report = appendIssues(
      validateCandidate(candidate.query, intent),
      organizationResolutionIssues(candidate.query, resolutions)
    );
    return {
      id: candidate.id,
      query: candidate.query,
      isValid: report.isValid,
      issues: report.issues.map(issue => issue.message)
    };
  });
  const diagnosticsJSON = JSON.stringify(diagnostics, null, 2);

  const reviewRequest = completionRequest(
    'wos_query_review',
    REVIEW_INSTRUCTIONS,
    `Research intent:
${intentJSON}

Organization-Enhanced name resolution:
${resolutionJSON}

Protected proper-name literals:
${protectedLiteralJSON}

Candidates and deterministic diagnostics:
${diagnosticsJSON}

Return JSON only.`,
    REVIEW_SCHEMA,
    2500
  );
  const review = await completeAndDecode(resolvedConfig, reviewRequest, 'query review', reportModelCall, signal);
  const reviewsByID = new Map((review.candidates || []).map(candidate => [candidate.id, candidate]));

  const seenReviewedQueries = new Set();
  const candidates = candidateDrafts.map(draft => {
    const reviewed = reviewsByID.get(draft.id);
    const query = normalizeProperNameFieldValues(
      protectProperNames(reviewed?.query || draft.query, protectedLiterals)
    );
    const queryKey = queryDeduplicationKey(query);
    if (!queryKey || seenReviewedQueries.has(queryKey)) {
      return null;
    }
    seenReviewedQueries.add(queryKey);
    return {
      id: draft.id,
      label: draft.label,
      query,
      review: reviewed?.explanation || '',
      validation: appendIssues(
        validateCandidate(query, intent),
        organizationResolutionIssues(query, resolutions)
      )
    };
  }).filter(Boolean);

  if (!candidates.length) {
    throw new Error('The model did not return any query candidates.');
  }

  await onStageChange('completed');
  return {
    intent,
    organizationResolutions: resolutions,
    candidates,
    usage
  };
}

module.exports = {
  runWosQueryPipeline,
  normalizeInput,
  decodeJSON,
  normalizeName,
  normalizeQuotedNames,
  protectProperNames,
  fieldExpressions,
  validateCandidate,
  organizationResolutions,
  protectedProperNameLiterals
};
