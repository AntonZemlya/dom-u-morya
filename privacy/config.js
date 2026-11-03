// METRICA-001: one approved production release; localhost/staging blocked by exact host gate and server receipt.
export const privacyConfig=Object.freeze({
 schemaVersion:1, analyticsConsentVersion:'analytics-2026-11-03-v2',
 purpose:'site_usage_analytics', preferenceKey:'domUMorya_analyticsConsent_v1', preferenceTtlDays:180,
 analyticsEnabled:true, approvedProductionHosts:['zhk-dom-umorya.ru'], metricaCounterId:113992596,
 operatorPolicyApproved:true, consentEvidenceMode:'server-receipt', receiptEndpoint:'/api/analytics-consent.php',
 vendorPayloadReviewApproved:true, siteOrigin:'https://zhk-dom-umorya.ru',
 allowedEvents:['phone_click','email_click','lead_accepted','pdf_download','plan_open'],
 analyticsCookieNames:['_ym_uid','_ym_d','_ym_isad','_ym_fa','_ym_ucs','_ym_metrika_enabled','_ym_debug','_ym_hostIndex','_ym_sup_debug'],
 analyticsStorageKeys:['_ym_uid','_ym_retryReqs','_ym_synced']
});
