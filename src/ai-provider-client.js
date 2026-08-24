'use strict';

const PROVIDER_PRESETS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    transport: 'responses',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5.6-luna',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    transport: 'anthropicMessages',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'https://api.anthropic.com/v1',
    model: '',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    transport: 'geminiGenerateContent',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: '',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openrouter',
    transport: 'chatCompletions',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'https://openrouter.ai/api/v1',
    model: '',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'compatible',
    transport: 'chatCompletions',
    structuredOutput: 'jsonObject',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    kind: 'compatible',
    transport: 'chatCompletions',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: '',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    kind: 'compatible',
    transport: 'chatCompletions',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    kind: 'compatible',
    transport: 'chatCompletions',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  },
  azureOpenAI: {
    id: 'azureOpenAI',
    name: 'Azure OpenAI',
    kind: 'azureOpenAI',
    transport: 'chatCompletions',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: '',
    model: '',
    requiresApiKey: true,
    apiVersion: '2024-10-21',
    local: false
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    kind: 'compatible',
    transport: 'chatCompletions',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: '',
    requiresApiKey: false,
    apiVersion: '',
    local: true
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'compatible',
    transport: 'chatCompletions',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: 'http://127.0.0.1:1234/v1',
    model: '',
    requiresApiKey: false,
    apiVersion: '',
    local: true
  },
  compatible: {
    id: 'compatible',
    name: 'OpenAI Compatible',
    kind: 'compatible',
    transport: 'chatCompletions',
    structuredOutput: 'jsonSchemaStrict',
    baseURL: '',
    model: '',
    requiresApiKey: true,
    apiVersion: '',
    local: false
  }
};

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'api-key',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
  'set-cookie'
]);

function presetFor(providerId) {
  return PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS.openai;
}

function normalizeBaseURL(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isLocalURL(value) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())
      || url.hostname.toLowerCase().endsWith('.local');
  } catch (_error) {
    return false;
  }
}

function validateConfiguration(config) {
  const baseURL = normalizeBaseURL(config.baseURL);
  if (!baseURL) {
    throw new Error('Enter a valid provider base URL.');
  }
  let parsed;
  try {
    parsed = new URL(baseURL);
  } catch (_error) {
    throw new Error('Enter a valid provider base URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Enter a valid provider base URL.');
  }
  if (parsed.protocol !== 'https:' && !isLocalURL(parsed.toString())) {
    throw new Error('Remote AI providers must use HTTPS. HTTP is allowed only for local endpoints.');
  }
  if (!String(config.model || '').trim()) {
    throw new Error('Enter the model identifier exposed by the provider.');
  }
  if (config.requiresApiKey && !String(config.apiKey || '').trim()) {
    throw new Error('API key missing. Add it in the LLM settings.');
  }
}

function endpointFor(config, path) {
  const baseURL = normalizeBaseURL(config.baseURL);
  const preset = presetFor(config.kind === 'azureOpenAI' ? 'azureOpenAI' : config.presetId || config.kind);

  if (preset.kind === 'gemini' && path === 'generateContent') {
    return `${baseURL}/models/${encodeURIComponent(config.model)}:generateContent`;
  }

  if (preset.kind === 'azureOpenAI') {
    if (path === 'models') {
      return `${baseURL}/openai/models`;
    }
    return `${baseURL}/openai/deployments/${encodeURIComponent(config.model)}/${path}`;
  }

  return `${baseURL}/${path}`;
}

function applyHeaders(headers, config) {
  const credential = String(config.apiKey || '').trim();
  if (credential) {
    const kind = config.kind || 'compatible';
    if (kind === 'anthropic') {
      headers['x-api-key'] = credential;
      headers['anthropic-version'] = '2023-06-01';
    } else if (kind === 'gemini') {
      headers['x-goog-api-key'] = credential;
    } else if (kind === 'azureOpenAI') {
      headers['api-key'] = credential;
    } else {
      headers.Authorization = `Bearer ${credential}`;
    }
  }

  for (const [name, value] of Object.entries(config.customHeaders || {})) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName || SENSITIVE_HEADER_NAMES.has(normalizedName.toLowerCase())) {
      continue;
    }
    headers[normalizedName] = String(value || '');
  }
}

function withApiVersion(url, config) {
  if (!String(config.apiVersion || '').trim()) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set('api-version', config.apiVersion);
  return parsed.toString();
}

function completionRequest(config, request) {
  validateConfiguration(config);
  const kind = config.kind || 'compatible';
  const transport = config.transport || presetFor(kind).transport;
  const structuredOutput = config.structuredOutput || presetFor(kind).structuredOutput;
  const schema = typeof request.schema === 'string'
    ? JSON.parse(request.schema)
    : request.schema;

  let instructions = request.instructions;
  if (kind === 'openrouter') {
    instructions = `${request.instructions}

OpenRouter compatibility requirement:
Return every required property in this exact JSON Schema. Do not
add, remove, or rename properties, even if the upstream provider
claims to enforce structured output:
${JSON.stringify(schema, null, 2)}`;
  }

  let url;
  let body;

  if (transport === 'responses') {
    url = endpointFor(config, 'responses');
    const responseBody = {
      model: config.model,
      instructions,
      input: request.input,
      store: false,
      max_output_tokens: request.maxOutputTokens
    };
    if (kind === 'openai') {
      responseBody.reasoning = { effort: 'none' };
    }
    if (structuredOutput === 'jsonSchemaStrict') {
      responseBody.text = {
        format: {
          type: 'json_schema',
          name: request.schemaName,
          strict: true,
          schema
        }
      };
    } else if (structuredOutput === 'jsonObject') {
      responseBody.text = { format: { type: 'json_object' } };
    }
    body = responseBody;
  } else if (transport === 'chatCompletions') {
    url = endpointFor(config, 'chat/completions');
    const chatBody = {
      model: config.model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: request.input }
      ],
      stream: false,
      max_tokens: request.maxOutputTokens
    };
    if (structuredOutput === 'jsonSchemaStrict') {
      chatBody.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema
        }
      };
    } else if (structuredOutput === 'jsonObject') {
      chatBody.response_format = { type: 'json_object' };
    }
    if (kind === 'openrouter' && structuredOutput !== 'promptOnly') {
      chatBody.provider = { require_parameters: true };
      chatBody.reasoning = { effort: 'none', exclude: true };
    }
    body = chatBody;
  } else if (transport === 'anthropicMessages') {
    url = endpointFor(config, 'messages');
    const anthropicBody = {
      model: config.model,
      system: instructions,
      messages: [{ role: 'user', content: request.input }],
      max_tokens: request.maxOutputTokens
    };
    if (structuredOutput === 'jsonSchemaStrict' || structuredOutput === 'jsonObject') {
      anthropicBody.output_config = {
        format: {
          type: 'json_schema',
          schema
        }
      };
    }
    body = anthropicBody;
  } else if (transport === 'geminiGenerateContent') {
    url = endpointFor(config, 'generateContent');
    const generationConfig = {
      maxOutputTokens: request.maxOutputTokens
    };
    if (structuredOutput === 'jsonSchemaStrict') {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseJsonSchema = schema;
    } else if (structuredOutput === 'jsonObject') {
      generationConfig.responseMimeType = 'application/json';
    }
    body = {
      systemInstruction: {
        parts: [{ text: instructions }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: request.input }]
        }
      ],
      generationConfig
    };
  } else {
    throw new Error(`Unsupported transport: ${transport}`);
  }

  if (kind === 'azureOpenAI') {
    url = withApiVersion(url, config);
  }

  const headers = { 'Content-Type': 'application/json' };
  applyHeaders(headers, config);

  return {
    url,
    options: {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }
  };
}

function errorMessage(data) {
  try {
    const object = JSON.parse(data);
    if (typeof object?.error === 'string') {
      return object.error.trim();
    }
    if (typeof object?.error?.message === 'string') {
      return object.error.message.trim();
    }
    for (const key of ['message', 'detail']) {
      if (typeof object?.[key] === 'string') {
        return object[key].trim();
      }
    }
  } catch (_error) {
    // Keep raw text below.
  }
  return String(data || '').trim();
}

function normalizeUsage(usage) {
  return {
    inputTokens: Number(usage?.inputTokens || usage?.input_tokens || usage?.prompt_tokens || usage?.promptTokens || 0) || 0,
    cachedInputTokens: Number(
      usage?.cachedInputTokens
      || usage?.input_tokens_details?.cached_tokens
      || usage?.prompt_tokens_details?.cached_tokens
      || usage?.cacheReadInputTokens
      || usage?.cache_read_input_tokens
      || usage?.cachedContentTokenCount
      || 0
    ) || 0,
    outputTokens: Number(usage?.outputTokens || usage?.output_tokens || usage?.completion_tokens || usage?.completionTokens || usage?.candidatesTokenCount || 0) || 0
  };
}

function extractResponseText(payload, transport) {
  if (!payload) return '';

  if (transport === 'responses') {
    if (typeof payload.output_text === 'string' && payload.output_text) {
      return payload.output_text;
    }
    const blocks = Array.isArray(payload.output)
      ? payload.output.flatMap(output => Array.isArray(output?.content) ? output.content : [])
      : [];
    return blocks
      .map(block => block?.text || block?.output_text || '')
      .filter(Boolean)
      .join('\n');
  }

  if (transport === 'chatCompletions') {
    const message = payload.choices?.[0]?.message || {};
    const values = [];
    if (typeof message.content === 'string') {
      values.push(message.content);
    }
    if (Array.isArray(message.content)) {
      values.push(...message.content.map(part => part?.text || '').filter(Boolean));
    }
    if (typeof message.reasoning_content === 'string') {
      values.push(message.reasoning_content);
    }
    if (typeof message.reasoning === 'string') {
      values.push(message.reasoning);
    }
    if (Array.isArray(message.reasoning_details)) {
      values.push(...message.reasoning_details.flatMap(item => [item?.text, item?.summary]).filter(Boolean));
    }
    return values.filter(Boolean).join('\n');
  }

  if (transport === 'anthropicMessages') {
    return (Array.isArray(payload.content) ? payload.content : [])
      .map(block => block?.text || '')
      .filter(Boolean)
      .join('\n');
  }

  if (transport === 'geminiGenerateContent') {
    return (payload.candidates || [])
      .flatMap(candidate => candidate?.content?.parts || [])
      .map(part => part?.text || '')
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

async function requestCompletion(config, request, runtimeOptions = {}) {
  const { url, options } = completionRequest(config, request);
  const response = await fetch(url, runtimeOptions.signal ? { ...options, signal: runtimeOptions.signal } : options);
  const data = await response.text();
  if (!response.ok) {
    const message = errorMessage(data);
    throw new Error(`${config.name || 'AI provider'} Error: ${response.status}${message ? ` - ${message}` : ''}`);
  }

  let payload;
  try {
    payload = JSON.parse(data);
  } catch (_error) {
    throw new Error('The AI provider returned a non-JSON response.');
  }

  const text = extractResponseText(payload, config.transport || presetFor(config.kind || 'compatible').transport);
  if (!text.trim()) {
    throw new Error('The AI provider returned no text content.');
  }

  return {
    text,
    usage: normalizeUsage(payload.usage || payload.usageMetadata || payload.usage_metadata)
  };
}

async function requestModels(config) {
  const preset = presetFor(config.presetId || config.kind || 'compatible');
  if (preset.kind === 'gemini') {
    const url = `${normalizeBaseURL(config.baseURL)}/models`;
    const headers = {};
    applyHeaders(headers, config);
    const response = await fetch(url, { headers });
    const data = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini models failed: ${response.status} - ${errorMessage(data)}`);
    }
    const payload = JSON.parse(data);
    return (payload.models || [])
      .map(model => String(model?.name || '').replace(/^models\//, '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  if (preset.kind === 'anthropic') {
    const url = `${normalizeBaseURL(config.baseURL)}/models`;
    const headers = {};
    applyHeaders(headers, config);
    const response = await fetch(url, { headers });
    const data = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic models failed: ${response.status} - ${errorMessage(data)}`);
    }
    const payload = JSON.parse(data);
    return (payload.data || [])
      .map(model => String(model?.id || model?.display_name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  const path = preset.kind === 'azureOpenAI' ? 'models' : 'models';
  let url = endpointFor(config, path);
  if (preset.kind === 'azureOpenAI') {
    url = withApiVersion(url, config);
  }
  const headers = {};
  applyHeaders(headers, config);
  const response = await fetch(url, { headers });
  const data = await response.text();
  if (!response.ok) {
    throw new Error(`Model list failed: ${response.status} - ${errorMessage(data)}`);
  }
  const payload = JSON.parse(data);
  const models = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  return models
    .map(model => String(model?.id || model?.model || model?.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

module.exports = {
  PROVIDER_PRESETS,
  presetFor,
  normalizeBaseURL,
  isLocalURL,
  validateConfiguration,
  completionRequest,
  requestCompletion,
  requestModels,
  extractResponseText,
  normalizeUsage
};
