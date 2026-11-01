// Same rules as ~/.claude/skills/github-bug/scripts/redact.py, plus a count of what was masked.
const KEEP_PARAMS = ['campaignNumber', 'flow', 'version', 'tenantId'];

const RULES = [
  // query strings can carry tokens or search terms; keep only the allow-listed params.
  // Runs first: the field rules below leave quotes in a query string that would cut this match short.
  ['query params', /\?([^\s"']+)/g, (counts) => (m, q) => {
    if (!q.includes('=')) return m;
    const parts = q.split('&');
    const kept = parts.filter((p) => KEEP_PARAMS.includes(p.split('=')[0]));
    counts['query params'] = (counts['query params'] || 0) + parts.length - kept.length;
    return '?' + kept.join('&');
  }],
  // auth material (scheme + token first, so "Authorization: Bearer x" loses the token too)
  ['tokens', /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 <redacted>'],
  ['tokens', /("?(auth-?token|access_token|refresh_token|password|otp|pin)"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)/gi, '$1"<redacted>"'],
  ['tokens', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>'],
  // personal data fields
  ['personal fields', /("?(mobileNumber|phone|altContactNumber|emailId|email|name|userName|givenName|familyName|fatherName|dob|aadhaar|nationalId)"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)/gi, '$1"<redacted>"'],
  ['emails', /[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>'],
  // phone numbers: international with spaces, or a bare 8-10 digit run (13-digit epoch ms stay readable)
  ['phone numbers', /\+\d[\d ]{7,14}\d/g, '<number>'],
  ['phone numbers', /(?<![\w-])\d{8,10}(?![\w-])/g, '<number>'],
];

// Returns { text, counts } where counts maps a rule label to how many values were masked.
export function redact(text, counts = {}) {
  let out = String(text ?? '');
  for (const [label, pattern, repl] of RULES) {
    if (typeof repl === 'function') {
      out = out.replace(pattern, repl(counts));
    } else {
      out = out.replace(pattern, (...args) => {
        counts[label] = (counts[label] || 0) + 1;
        return args[0].replace(new RegExp(pattern.source, pattern.flags.replace('g', '')), repl);
      });
    }
  }
  for (const k of Object.keys(counts)) if (!counts[k]) delete counts[k];
  return { text: out, counts };
}
