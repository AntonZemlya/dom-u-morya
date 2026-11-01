// METRICA-001: activation is a separate reviewed release, never a preview override.
export const privacyConfig=Object.freeze({
 schemaVersion:1, analyticsConsentVersion:'analytics-2026-11-02-v1',
 purpose:'site_usage_analytics', preferenceKey:'domUMorya_analyticsConsent_v1', preferenceTtlDays:180,
 analyticsEnabled:false, approvedProductionHosts:['zhk-dom-umorya.ru'], metricaCounterId:113992596,
 operatorPolicyApproved:false, consentEvidenceMode:'server-receipt', receiptEndpoint:'/api/analytics-consent.php',
 vendorPayloadReviewApproved:false, siteOrigin:'https://zhk-dom-umorya.ru',
 allowedEvents:['phone_click','email_click','lead_accepted','pdf_download','plan_open'],
 analyticsCookieNames:['_ym_uid','_ym_d','_ym_isad','_ym_fa','_ym_ucs','_ym_metrika_enabled','_ym_debug','_ym_hostIndex','_ym_sup_debug'],
 analyticsStorageKeys:['_ym_uid','_ym_retryReqs','_ym_synced']
});
