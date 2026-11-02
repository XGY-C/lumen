#!/usr/bin/env node
/**
 * Lumen launcher — starts the Spring Boot API and the Vite web app together.
 *
 * Why a launcher instead of two terminals:
 *   - The order matters. The web app is useless until 8015 answers, and the API
 *     takes ~3s to boot. This waits for the port instead of making you guess.
 *   - Both processes share one Ctrl+C. Vite spawns esbuild and the JVM spawns
 *     worker threads; a plain `kill` on Windows leaves orphans behind, so this
 *     kills the whole tree.
 *   - It encodes the two environment traps this machine actually hits:
 *       * `java.io.tmpdir` resolves to garbage when a non-ASCII user name is
 *         passed through Git Bash (see README), so it is pinned to a project
 *         folder that we know is writable.
 *       * Port conflicts must be reported as such, not as "connection refused".
 *
 * Usage:
 *   node scripts/dev.mjs            start everything
 *   node scripts/dev.mjs --rebuild  force a backend rebuild first
 *   node scripts/dev.mjs --web-only skip the API entirely
 *   node scripts/dev.mjs --help
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ------------------------------------------------------------------ */
/* Paths and constants                                                 */
/* ------------------------------------------------------------------ */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND_DIR = join(ROOT, 'backend')
const JAR = join(BACKEND_DIR, 'target', 'ai-chat-backend-0.1.0.jar')
const VITE_BIN = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const TMP_DIR = join(ROOT, '.tmp')

const API_PORT = 8015
const WEB_PORT = 5185
const MODEL_PORT = 1235

const steps = 5

/* ------------------------------------------------------------------ */
/* Terminal output                                                     */
/* ------------------------------------------------------------------ */

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const paint = (code) => (text) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : String(text)

const bold = paint('1')
const gray = paint('90')
const red = paint('31')
const green = paint('32')
const yellow = paint('33')
const cyan = paint('36')
const magenta = paint('35')

const OK = green('✓')
const BAD = red('✗')
const WARN = yellow('!')

function step(index, message) {
  console.log(`\n${gray(`[${index}/${steps}]`)} ${bold(message)}`)
}

function detail(message) {
  console.log(`        ${gray(message)}`)
}

function fail(message, hint) {
  console.error(`\n${BAD} ${message}`)
  for (const line of String(hint ?? '').split('\n')) {
    if (line) console.error(`  ${gray(line)}`)
  }
  console.error('')
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const argv = new Set(process.argv.slice(2))
const flag = (name) => argv.has(`--${name}`)

if (flag('help') || flag('h')) {
  console.log(`
${bold('Lumen launcher')}

  node scripts/dev.mjs [options]

${bold('Options')}
  --rebuild     Rebuild the backend jar before starting
  --web-only    Start only the Vite dev server (no API)
  --help        Show this message

${bold('Ports')}
  ${WEB_PORT}  web app      ${gray('(vite)')}
  ${API_PORT}  api          ${gray('(spring boot)')}
  ${MODEL_PORT}  local model  ${gray('(lm studio, must be running separately)')}
`)
  process.exit(0)
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** True when something is already listening on the port. */
function probe(port) {
  return new Promise((done) => {
    const socket = net.connect({ port, host: 'localhost' })
    const finish = (inUse) => {
      socket.destroy()
      done(inUse)
    }
    socket.setTimeout(700)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(port)) return true
    await sleep(300)
  }
  return false
}

function hasCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return !result.error && result.status === 0
}

/* ------------------------------------------------------------------ */
/* Port preparation                                                    */
/* ------------------------------------------------------------------ */

/**
 * `java.io.tmpdir` is unusable when the project lives under a non-ASCII path
 * (a Chinese Windows user folder is the common case). Fall back to the system
 * drive in that situation — it always exists and `java -version` proves Java
 * can start from there.
 */
function resolveTmpDir() {
  const ascii = /^[\x20-\x7e]+$/.test(TMP_DIR)
  const target = ascii ? TMP_DIR : join(process.env.SystemDrive ?? 'C:', 'Temp', 'lumen-dev')
  try {
    mkdirSync(target, { recursive: true })
    return target
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Child processes                                                     */
/* ------------------------------------------------------------------ */

const children = []
let shuttingDown = false

/** Prefix every line so two interleaved logs stay readable. */
function pipeTagged(stream, tag) {
  if (!stream) return
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    // Split on CR as well: progress bars and "ready in Xms" both use it.
    const lines = buffer.split(/\r\n|\r|\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) console.log(`${tag} ${line}`)
    }
    // A never-terminated progress bar would otherwise grow without bound.
    if (buffer.length > 4096) {
      console.log(`${tag} ${buffer}`)
      buffer = ''
    }
  })
  stream.on('end', () => {
    if (buffer.trim()) console.log(`${tag} ${buffer}`)
  })
}

function launch({ name, tag, command, args, cwd }) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)

  pipeTagged(child.stdout, tag)
  pipeTagged(child.stderr, tag)

  child.on('error', (error) => {
    if (shuttingDown) return
    console.error(`\n${BAD} ${name} could not start: ${error.message}`)
    shutdown(1)
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    const reason = signal ? `signal ${signal}` : `code ${code}`
    console.error(`\n${BAD} ${name} stopped unexpectedly (${reason}).`)
    shutdown(1)
  })

  return child
}

/**
 * Kill the whole tree. `child.kill()` on Windows only signals the direct child;
 * Vite's esbuild service and the JVM's threads survive it and keep the ports
 * bound, so the next run fails with "port already in use".
 */
function killTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n${gray('→')} Stopping services...`)
  for (const child of children) killTree(child)
  setTimeout(() => process.exit(code), 400)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\n${bold('Lumen')} ${gray('· dev launcher')}`)
  console.log(gray('─'.repeat(38)))

  const webOnly = flag('web-only')

  /* 1. Toolchain --------------------------------------------------- */

  step(1, 'Toolchain')

  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor < 20) {
    fail(`Node ${process.versions.node} is too old.`, 'Lumen requires Node 20 or newer.')
  }
  console.log(`  ${OK} node ${process.versions.node}`)

  if (!existsSync(VITE_BIN)) {
    fail('Vite is not installed.', 'Run `npm install` in the project root first.')
  }

  let javaBanner = null
  if (!webOnly) {
    if (!hasCommand('java', ['-version'])) {
      fail('Java is not available on PATH.', 'Install JDK 21, or start the API from your IDE instead.')
    }
    const javaCheck = spawnSync('java', ['-version'], { encoding: 'utf8' })
    javaBanner = (javaCheck.stderr || javaCheck.stdout).split('\n')[0].trim()
    console.log(`  ${OK} ${javaBanner}`)
  }

  /* 2. Ports ------------------------------------------------------- */

  step(2, `Ports ${WEB_PORT} / ${API_PORT} / ${MODEL_PORT}`)

  if (await probe(WEB_PORT)) {
    // Leaving the actual commands here matters: the usual cause is a previous
    // run that was closed with the X button, which kills node but leaves Vite
    // holding the port. "Close it" is useless advice if you cannot find it.
    fail(
      `Port ${WEB_PORT} is already in use.`,
      `Find the owner:  netstat -ano | findstr :${WEB_PORT}\n` +
        `Stop it:         taskkill /PID <pid> /T /F`,
    )
  }
  console.log(`  ${OK} ${WEB_PORT} is free`)

  const modelUp = await probe(MODEL_PORT)
  if (modelUp) {
    console.log(`  ${OK} ${MODEL_PORT} local model is reachable`)
  } else {
    console.log(`  ${WARN} ${MODEL_PORT} local model is not reachable`)
    detail('Chat will fail until LM Studio is running with an OpenAI-compatible server.')
  }

  // An API that is already up is not an error: it is the common case when you
  // restart only the frontend. Skip it and say so.
  const apiAlreadyUp = !webOnly && (await probe(API_PORT))
  if (webOnly) {
    console.log(`  ${gray('–')} ${API_PORT} skipped (--web-only)`)
  } else if (apiAlreadyUp) {
    console.log(`  ${WARN} ${API_PORT} already in use — reusing the running API`)
    detail('If that process is not this project, stop it first.')
  } else {
    console.log(`  ${OK} ${API_PORT} is free`)
  }

  /* 3. Backend artifact -------------------------------------------- */

  step(3, 'Backend artifact')

  const needBuild = !webOnly && !apiAlreadyUp && (flag('rebuild') || !existsSync(JAR))

  if (webOnly || apiAlreadyUp) {
    console.log(`  ${gray('–')} skipped`)
  } else if (needBuild) {
    if (!hasCommand('mvn', ['-v'])) {
      fail(
        'The backend jar is missing and Maven is not on PATH.',
        'Build it once with `cd backend && mvn -DskipTests package`, or run it from your IDE.',
      )
    }
    console.log(`  ${yellow('building')} mvn -B -DskipTests package`)
    const build = spawnSync('mvn', ['-B', '-DskipTests', 'package'], {
      cwd: BACKEND_DIR,
      stdio: 'inherit',
      shell: true,
    })
    if (build.status !== 0) {
      fail('Backend build failed.', 'Read the Maven output above, fix it, then run this again.')
    }
    console.log(`  ${OK} jar rebuilt`)
  } else {
    console.log(`  ${OK} using existing jar`)
    detail('Pass --rebuild to force a rebuild.')
  }

  /* 4. API --------------------------------------------------------- */

  step(4, 'Spring Boot API')

  if (webOnly || apiAlreadyUp) {
    console.log(`  ${gray('–')} not started`)
  } else {
    const tmpDir = resolveTmpDir()
    if (!tmpDir) {
      fail('No writable temp directory could be prepared.', `Tried: ${TMP_DIR}`)
    }

    launch({
      name: 'API',
      tag: cyan('[api]'),
      command: 'java',
      // The jar already sets server.tomcat.basedir, so Tomcat does not depend on
      // java.io.tmpdir. Passing it anyway keeps the launcher correct even if the
      // jar predates that fix.
      args: [`-Djava.io.tmpdir=${tmpDir}`, '-jar', JAR, `--server.port=${API_PORT}`],
      cwd: BACKEND_DIR,
    })

    const up = await waitForPort(API_PORT, 90_000)
    if (!up) {
      fail('The API did not open its port within 90s.', 'Check the [api] log above for the reason.')
    }
    console.log(`  ${OK} listening on ${API_PORT}`)
  }

  /* 5. Web --------------------------------------------------------- */

  step(5, 'Vite web app')

  launch({
    name: 'WEB',
    tag: magenta('[web]'),
    command: process.execPath,
    args: [VITE_BIN, '--port', String(WEB_PORT), '--strictPort'],
    cwd: ROOT,
  })

  const webUp = await waitForPort(WEB_PORT, 60_000)
  if (!webUp) {
    fail('Vite did not open its port within 60s.', 'Check the [web] log above for the reason.')
  }
  console.log(`  ${OK} listening on ${WEB_PORT}`)

  /* Ready ---------------------------------------------------------- */

  console.log(`\n${green('━'.repeat(38))}`)
  console.log(`${OK} ${bold('Ready')}`)
  console.log(`  ${bold('App')}  ${cyan(`http://localhost:${WEB_PORT}`)}`)
  if (!webOnly) {
    console.log(`  ${bold('API')}  ${gray(`http://localhost:${API_PORT}`)}`)
  }
  if (modelUp) {
    console.log(`  ${bold('Model')} ${gray(`http://localhost:${MODEL_PORT}/v1`)}`)
  }
  console.log(`\n  ${gray('Ctrl+C stops both processes.')}\n`)
}

main().catch((error) => {
  console.error(`\n${BAD} ${error?.stack ?? error}`)
  shutdown(1)
})
