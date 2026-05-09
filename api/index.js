module.exports = async function handler(req, res) {
  const mod = await import('../telegram-mini-app/api/index.js')
  return mod.default(req, res)
}

