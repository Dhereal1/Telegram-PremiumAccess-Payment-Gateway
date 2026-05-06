import crypto from 'crypto'

export function getRequestId(req) {
  const header = req.headers['x-request-id']
  const fromHeader = Array.isArray(header) ? header[0] : header
  return (typeof fromHeader === 'string' && fromHeader) || crypto.randomUUID()
}
