/**
 * INV-PREP-02C — Testes OFFLINE do workflow de diagnóstico OIDC
 * (`node --test tests/inventory-oidc/oidc-diagnostic-workflow.test.mjs`; requer as dependências do
 * projeto para ler YAML). Não roda no job de diagnóstico. Simula gatilho e validações do `guard`
 * localmente, com repositórios Git temporários — sem GitHub, sem token, sem Google.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RAW = readFileSync(join(ROOT, '.github', 'workflows', 'inv-uxpt-oidc-diagnostic.yml'), 'utf8')
const WF = parseYaml(RAW)
const TRIGGER = 'ops/inventory/oidc-diagnostic-trigger.txt'

test('OIDC-W01 — gatilho exclusivo: push no develop alterando o arquivo de disparo do diagnóstico', () => {
  assert.deepEqual(Object.keys(WF.on), ['push'])
  assert.deepEqual(WF.on.push, { branches: ['develop'], paths: [TRIGGER] })
  const triggers = (branch, files) => WF.on.push.branches.includes(branch) && files.some((f) => WF.on.push.paths.includes(f))
  assert.equal(triggers('develop', ['scripts/inventory/oidc-claims-diagnostic.mjs', '.github/workflows/inv-uxpt-oidc-diagnostic.yml', 'docs/uxpt/INV-PREP-02C-diagnostico.md']), false, 'commit de preparação não dispara')
  assert.equal(triggers('develop', ['ops/inventory/trigger.txt']), false, 'disparo do inventário não aciona o diagnóstico')
  assert.equal(triggers('main', [TRIGGER]), false)
  assert.equal(triggers('develop', [TRIGGER]), true)
})

test('OIDC-W02 — permissões mínimas: id-token só no job com o ambiente protegido; limites e concorrência', () => {
  assert.deepEqual(WF.permissions, { contents: 'read' })
  assert.deepEqual(WF.concurrency, { group: 'inv-uxpt-oidc-diagnostic', 'cancel-in-progress': false })
  assert.deepEqual(WF.jobs.guard.permissions, { contents: 'read' })
  assert.equal(WF.jobs.guard.environment, undefined)
  const job = WF.jobs['oidc-claims']
  assert.deepEqual(job.permissions, { contents: 'read', 'id-token': 'write' })
  assert.equal(job.environment, 'inv-uxpt-01')
  assert.equal(job.needs, 'guard')
  for (const j of Object.values(WF.jobs)) {
    assert.ok(j['timeout-minutes'] > 0 && j['timeout-minutes'] <= 5)
    for (const s of j.steps) {
      if (s.uses) assert.match(s.uses, /@[0-9a-f]{40}$/, 'action fixada por SHA completo')
      if (s.uses?.startsWith('actions/checkout')) assert.equal(s.with['persist-credentials'], false)
    }
  }
})

test('OIDC-W03 — isolamento: sem autenticação Google, sem dependências instaladas, sem artefato com token', () => {
  const code = RAW.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.ok(!/google-github-actions|googleapis|gcloud|workload_identity|service_account|credentials_json|firebase|firestore|INV_UXPT_ENABLED|INV_UXPT_APPROVED_BASE_SHA/i.test(code))
  assert.ok(!/upload-artifact|npm (ci|install)|secrets\./.test(code))
  const runs = WF.jobs['oidc-claims'].steps.map((s) => s.run ?? '').join('\n')
  assert.equal((runs.match(/\bnode scripts\//g) ?? []).length, 1, 'uma única execução do script')
  assert.ok(!/\b(curl|wget|eval|source|bash -c)\b/.test(runs))
  const testIndex = WF.jobs['oidc-claims'].steps.findIndex((s) => s.run === 'node --test tests/inventory-oidc/oidc-claims-diagnostic.test.mjs')
  const diagIndex = WF.jobs['oidc-claims'].steps.findIndex((s) => s.id === 'diagnostic')
  assert.ok(testIndex >= 0 && testIndex < diagIndex, 'testes offline antes do token')
})

// ------------------------------------------------------------------ simulação local do guard

const guard = () => {
  const runs = WF.jobs.guard.steps.filter((s) => s.run)
  assert.equal(runs.length, 2)
  return { context: runs[0].run, commit: runs[1].run }
}
const bash = (script, env, cwd) => spawnSync('bash', ['-c', script], { cwd, env: { PATH: process.env.PATH, HOME: tmpdir(), ...env }, encoding: 'utf8' })
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Teste Ficticio', '-c', 'user.email=teste@exemplo.invalid', ...args], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'oidc-diag-git-'))
  git(dir, 'init', '-q', '-b', 'develop')
  mkdirSync(join(dir, 'scripts', 'inventory'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'inventory', 'oidc-claims-diagnostic.mjs'), '// revisado\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'base revisada')
  return { dir, base: git(dir, 'rev-parse', 'HEAD') }
}
const writeTrigger = (dir, text = 'diagnostico autorizado\n') => {
  mkdirSync(join(dir, 'ops', 'inventory'), { recursive: true })
  writeFileSync(join(dir, TRIGGER), text)
}
const CONTEXT_OK = { REPOSITORY: 'rodrigues01martins/sigosc2.0', REF: 'refs/heads/develop', EVENT: 'push', FORCED: 'false', ENABLED: 'true', APPROVED_BASE: 'a'.repeat(40) }

test('OIDC-W04 — guard (contexto): repositório, branch, evento, push forçado e variáveis administrativas', () => {
  const { context } = guard()
  assert.equal(bash(context, CONTEXT_OK).status, 0)
  for (const [name, change] of Object.entries({
    'outro repositório': { REPOSITORY: 'terceiro/sigosc2.0' },
    'outro branch': { REF: 'refs/heads/main' },
    'outro evento': { EVENT: 'workflow_dispatch' },
    'push forçado': { FORCED: 'true' },
    'não habilitado': { ENABLED: '' },
    'base ausente': { APPROVED_BASE: '' },
    'base inválida': { APPROVED_BASE: 'develop' },
  })) {
    const r = bash(context, { ...CONTEXT_OK, ...change })
    assert.notEqual(r.status, 0, name)
    assert.match(r.stdout, /::error::/)
  }
})

test('OIDC-W05 — guard (commit): um pai, pai aprovado, somente o disparo, sem merge e sem alterar script/workflow', () => {
  const { commit } = guard()
  const check = (dir, approved) => bash(commit, { SHA: git(dir, 'rev-parse', 'HEAD'), APPROVED_BASE: approved }, dir)
  let r = repo()
  writeTrigger(r.dir)
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo')
  assert.equal(check(r.dir, r.base).status, 0, 'disparo válido')
  assert.notEqual(check(r.dir, 'b'.repeat(40)).status, 0, 'pai diferente do aprovado')
  // Disparo que também altera o script do diagnóstico.
  r = repo()
  writeTrigger(r.dir)
  writeFileSync(join(r.dir, 'scripts', 'inventory', 'oidc-claims-diagnostic.mjs'), 'console.log(process.env)\n')
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo com script alterado')
  assert.notEqual(check(r.dir, r.base).status, 0, 'altera o script')
  // Merge.
  r = repo()
  git(r.dir, 'checkout', '-q', '-b', 'lateral')
  writeFileSync(join(r.dir, 'x.txt'), 'x\n')
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'lateral')
  git(r.dir, 'checkout', '-q', 'develop')
  writeTrigger(r.dir)
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo')
  git(r.dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'lateral')
  assert.notEqual(check(r.dir, git(r.dir, 'rev-parse', 'HEAD^1')).status, 0, 'merge')
  // Exclusão do disparo e arquivo grande.
  r = repo()
  writeTrigger(r.dir)
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo')
  const trigger = git(r.dir, 'rev-parse', 'HEAD')
  git(r.dir, 'rm', '-q', TRIGGER)
  git(r.dir, 'commit', '-q', '-m', 'remove')
  assert.notEqual(check(r.dir, trigger).status, 0, 'exclusão')
  r = repo()
  writeTrigger(r.dir, 'x'.repeat(2048))
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'grande')
  assert.notEqual(check(r.dir, r.base).status, 0, 'arquivo grande')
})
