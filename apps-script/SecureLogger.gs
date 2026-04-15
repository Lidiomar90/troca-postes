function maskValue_(value) {
  const raw = String(value || '');
  if (!raw) return '[EMPTY]';
  if (raw.length <= 6) return '***';
  return raw.slice(0,3) + '***' + raw.slice(-3);
}

function redactSecrets_(text) {
  let output = String(text || '');
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).forEach(function(k){
    const v = props[k];
    if (v) output = output.split(String(v)).join('[REDACTED]');
  });
  return output;
}

function secureLog_(level, message, details) {
  const payload = {
    ts: new Date().toISOString(),
    level: level || 'INFO',
    message: redactSecrets_(message),
    details: redactSecrets_(details ? JSON.stringify(details) : '')
  };
  Logger.log(JSON.stringify(payload));
}
