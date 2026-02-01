import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'

const PORT = process.env.PORT || 3000
const ROOT = import.meta.dirname
const PROJECT_ROOT = join(ROOT, '..')

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  try {
    // Serve grasshopper.js from project root
    if (pathname === '/grasshopper.js') {
      log(req, 200, 'file', 'grasshopper.js')
      return serveFile(res, join(PROJECT_ROOT, 'grasshopper.js'))
    }

    // Root -> hub
    if (pathname === '/') {
      log(req, 200, 'file', 'pages/index.html')
      return serveFile(res, join(ROOT, 'pages', 'index.html'))
    }

    // Static files under /pages/
    if (pathname.startsWith('/pages/')) {
      const rel = pathname.slice('/pages/'.length)
      if (rel.includes('..')) {
        log(req, 404)
        return notFound(res)
      }
      log(req, 200, 'file', `pages/${rel}`)
      return serveFile(res, join(ROOT, 'pages', rel))
    }

    // Redirects
    if (pathname === '/redirect/301') {
      log(req, 301, 'redirect', '/pages/redirect-target.html')
      res.writeHead(301, { Location: '/pages/redirect-target.html' })
      return res.end()
    }
    if (pathname === '/redirect/302') {
      log(req, 302, 'redirect', '/pages/redirect-target.html')
      res.writeHead(302, { Location: '/pages/redirect-target.html' })
      return res.end()
    }
    if (pathname === '/redirect/external') {
      log(req, 302, 'redirect', 'https://example.com')
      res.writeHead(302, { Location: 'https://example.com' })
      return res.end()
    }
    if (pathname === '/redirect/cors') {
      log(req, 302, 'redirect', `http://localhost:${PORT + 1}/`)
      res.writeHead(302, { Location: `http://localhost:${PORT + 1}/` })
      return res.end()
    }

    // Slow response
    if (pathname === '/slow') {
      const delay = parseInt(url.searchParams.get('delay')) || 3000
      log(req, 200, 'slow', `delay=${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
      if (res.destroyed) return
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(slowHTML(delay))
    }

    // Form handler (GET and POST)
    if (pathname === '/form') {
      let params
      if (req.method === 'POST') {
        const body = await collectBody(req)
        params = new URLSearchParams(body)
      } else {
        params = url.searchParams
      }
      log(req, 200, 'form', Object.fromEntries(params))
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(formResultHTML(req.method, params))
    }

    // Track form handler (POST with changed tracked element)
    if (pathname === '/track-form' && req.method === 'POST') {
      await collectBody(req)
      log(req, 200, 'track-form', 'POST')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(trackFormResultHTML())
    }

    // Track form redirect handler (POST that redirects to page with changed tracked element)
    if (pathname === '/track-form-redirect' && req.method === 'POST') {
      await collectBody(req)
      log(req, 302, 'track-form-redirect', '/pages/track-changed.html')
      res.writeHead(302, { Location: '/pages/track-changed.html' })
      return res.end()
    }

    // Unsupported content type
    if (pathname === '/unsupported') {
      log(req, 200, 'json', 'application/json')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ type: 'json', message: 'This is not HTML' }))
    }

    log(req, 404)
    notFound(res)
  } catch (err) {
    log(req, 500, 'error', err.message)
    console.error(err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
    }
    res.end('Internal Server Error')
  }
})

server.listen(PORT, () => console.log(`http://localhost:${PORT}`))

// Minimal CORS server on PORT+1 for cross-origin redirect testing
createServer((req, res) => {
  console.log(`GET localhost:${PORT + 1}/ 200 cors-target`)
  res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' })
  res.end('<!DOCTYPE html><html><head><title>CORS</title><meta name="hop" content="true"/></head><body><h1>Cross-Origin Page</h1><a href="http://localhost:' + PORT + '/">Back</a></body></html>')
}).listen(PORT + 1, () => console.log(`http://localhost:${PORT + 1} (cors)`))

// --- helpers ---

function log(req, status, type, detail) {
  const parts = [req.method, req.url, status]
  if (type) parts.push(type)
  if (detail !== undefined) parts.push(typeof detail === 'object' ? JSON.stringify(detail) : detail)
  console.log(parts.join(' '))
}

async function serveFile(res, filePath) {
  try {
    const content = await readFile(filePath)
    const type = MIME[extname(filePath)] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type })
    res.end(content)
  } catch {
    notFound(res)
  }
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formResultHTML(method, params) {
  const items = [...params.entries()]
    .map(([k, v]) => `    <li><strong>${esc(k)}</strong>: ${esc(v)}</li>`)
    .join('\n')

  return `<!DOCTYPE html>
<html>
<head>
  <title>Form Result</title>
  <script src="/grasshopper.js"></script>
  <meta name="hop" content="true" />
</head>
<body>
  <h1>Form ${esc(method)} Result</h1>
  <ul>
${items}
  </ul>
  <nav>
    <a href="/">Hub</a>
    <a href="/pages/form-get.html">GET form</a>
    <a href="/pages/form-post.html">POST form</a>
  </nav>
</body>
</html>`
}

function slowHTML(delay) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Slow Page</title>
  <script src="/grasshopper.js"></script>
  <meta name="hop" content="true" />
</head>
<body>
  <h1>Slow Page</h1>
  <p>Response was delayed by ${delay}ms.</p>
  <nav>
    <a href="/">Hub</a>
    <a href="/slow?delay=${delay}">Reload (same delay)</a>
  </nav>
</body>
</html>`
}

function trackFormResultHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Track Form Result</title>
  <script src="/grasshopper.js"></script>
  <meta name="hop" content="true" />
  <link rel="stylesheet" href="/styles.css?v=2" data-hop-track="reload">
</head>
<body>
  <h1>Track Form Result</h1>
  <p>This page has a different tracked stylesheet (v=2).</p>
  <nav>
    <a href="/">Hub</a>
    <a href="/pages/track-form.html">Back</a>
  </nav>
</body>
</html>`
}
