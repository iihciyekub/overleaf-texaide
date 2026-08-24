'use strict';

const CSL_LOCALES = Object.freeze([
  ['af-ZA', require('citeproc-locales/locales/locales-af-ZA.xml')],
  ['ar', require('citeproc-locales/locales/locales-ar.xml')],
  ['bg-BG', require('citeproc-locales/locales/locales-bg-BG.xml')],
  ['ca-AD', require('citeproc-locales/locales/locales-ca-AD.xml')],
  ['cs-CZ', require('citeproc-locales/locales/locales-cs-CZ.xml')],
  ['cy-GB', require('citeproc-locales/locales/locales-cy-GB.xml')],
  ['da-DK', require('citeproc-locales/locales/locales-da-DK.xml')],
  ['de-AT', require('citeproc-locales/locales/locales-de-AT.xml')],
  ['de-CH', require('citeproc-locales/locales/locales-de-CH.xml')],
  ['de-DE', require('citeproc-locales/locales/locales-de-DE.xml')],
  ['el-GR', require('citeproc-locales/locales/locales-el-GR.xml')],
  ['en-GB', require('citeproc-locales/locales/locales-en-GB.xml')],
  ['en-US', require('citeproc-locales/locales/locales-en-US.xml')],
  ['es-CL', require('citeproc-locales/locales/locales-es-CL.xml')],
  ['es-ES', require('citeproc-locales/locales/locales-es-ES.xml')],
  ['es-MX', require('citeproc-locales/locales/locales-es-MX.xml')],
  ['et-EE', require('citeproc-locales/locales/locales-et-EE.xml')],
  ['eu', require('citeproc-locales/locales/locales-eu.xml')],
  ['fa-IR', require('citeproc-locales/locales/locales-fa-IR.xml')],
  ['fi-FI', require('citeproc-locales/locales/locales-fi-FI.xml')],
  ['fr-CA', require('citeproc-locales/locales/locales-fr-CA.xml')],
  ['fr-FR', require('citeproc-locales/locales/locales-fr-FR.xml')],
  ['he-IL', require('citeproc-locales/locales/locales-he-IL.xml')],
  ['hr-HR', require('citeproc-locales/locales/locales-hr-HR.xml')],
  ['hu-HU', require('citeproc-locales/locales/locales-hu-HU.xml')],
  ['id-ID', require('citeproc-locales/locales/locales-id-ID.xml')],
  ['is-IS', require('citeproc-locales/locales/locales-is-IS.xml')],
  ['it-IT', require('citeproc-locales/locales/locales-it-IT.xml')],
  ['ja-JP', require('citeproc-locales/locales/locales-ja-JP.xml')],
  ['km-KH', require('citeproc-locales/locales/locales-km-KH.xml')],
  ['ko-KR', require('citeproc-locales/locales/locales-ko-KR.xml')],
  ['la', require('citeproc-locales/locales/locales-la.xml')],
  ['lt-LT', require('citeproc-locales/locales/locales-lt-LT.xml')],
  ['lv-LV', require('citeproc-locales/locales/locales-lv-LV.xml')],
  ['mn-MN', require('citeproc-locales/locales/locales-mn-MN.xml')],
  ['nb-NO', require('citeproc-locales/locales/locales-nb-NO.xml')],
  ['nl-NL', require('citeproc-locales/locales/locales-nl-NL.xml')],
  ['nn-NO', require('citeproc-locales/locales/locales-nn-NO.xml')],
  ['pl-PL', require('citeproc-locales/locales/locales-pl-PL.xml')],
  ['pt-BR', require('citeproc-locales/locales/locales-pt-BR.xml')],
  ['pt-PT', require('citeproc-locales/locales/locales-pt-PT.xml')],
  ['ro-RO', require('citeproc-locales/locales/locales-ro-RO.xml')],
  ['ru-RU', require('citeproc-locales/locales/locales-ru-RU.xml')],
  ['sk-SK', require('citeproc-locales/locales/locales-sk-SK.xml')],
  ['sl-SI', require('citeproc-locales/locales/locales-sl-SI.xml')],
  ['sr-RS', require('citeproc-locales/locales/locales-sr-RS.xml')],
  ['sv-SE', require('citeproc-locales/locales/locales-sv-SE.xml')],
  ['th-TH', require('citeproc-locales/locales/locales-th-TH.xml')],
  ['tr-TR', require('citeproc-locales/locales/locales-tr-TR.xml')],
  ['uk-UA', require('citeproc-locales/locales/locales-uk-UA.xml')],
  ['vi-VN', require('citeproc-locales/locales/locales-vi-VN.xml')],
  ['zh-CN', require('citeproc-locales/locales/locales-zh-CN.xml')],
  ['zh-TW', require('citeproc-locales/locales/locales-zh-TW.xml')]
]);

const registerCslLocales = registry => {
  CSL_LOCALES.forEach(([id, source]) => {
    const xml = typeof source === 'string' ? source : source?.default;
    if (xml && !registry.has(id)) registry.add(id, xml);
  });
  return registry;
};

module.exports = { CSL_LOCALES, registerCslLocales };
