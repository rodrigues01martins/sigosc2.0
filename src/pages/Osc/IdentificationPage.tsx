import type { ReactNode } from 'react'
import { CheckIcon } from '../../components/ds/icons.tsx'
import ds from '../../components/ds/ds.module.css'
import { ContextBar } from '../../components/osc/ContextBar.tsx'
import { PERMISSION_MODULES, permissionLabel, type Authority } from '../../domain/authorization.ts'
import type { Membership } from '../../services/organizations/types.ts'
import { REGISTRATION_LABEL } from '../Organizations/labels.ts'
import { AUTHORITY_LABEL, COMMERCIAL_BADGE_LABEL } from './oscLabels.ts'

interface Props {
  membership: Membership
  authority: Authority
  canManagePermissions: boolean
  onConsultPartnerships(): void
  onUsersAndPermissions(): void
}

const COMMERCIAL_CLASS = { active: ds.commercialRegular, suspended: ds.commercialSuspended, pending: ds.commercialOther, cancelled: ds.commercialOther }

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={ds.field}>
      <span className={ds.fieldLabel}>{label}</span>
      {children}
    </div>
  )
}

/**
 * PAG-OSC01 — Identificação da OSC (layout HF-G05). Somente dados reais já
 * disponíveis: nome, situação cadastral e comercial, administrador único (fonte
 * autoritativa), competência e permissões do usuário. CNPJ e quantidade de
 * parcerias ainda não existem no modelo de dados e por isso não são exibidos.
 */
export function IdentificationPage({ membership, authority, canManagePermissions, onConsultPartnerships, onUsersAndPermissions }: Props) {
  const organization = membership.organization
  if (!organization) return null
  const administrator =
    authority === 'administrator' ? 'Você' : organization.administratorUid ? 'Designado pela administração da plataforma' : 'Não designado'

  return (
    <>
      <ContextBar oscName={organization.name} />

      <section className={ds.card} aria-labelledby="osc01-dados">
        <h2 id="osc01-dados" className={ds.sectionTitle}>
          Dados da organização
        </h2>
        <div className={ds.fieldGrid}>
          <Field label="Identificação">
            <div className={ds.fieldValue}>{organization.name}</div>
          </Field>
          <Field label="Situação cadastral">
            <div className={ds.fieldValue}>{REGISTRATION_LABEL[organization.registrationStatus]}</div>
          </Field>
          <Field label="Situação da assinatura">
            <div className={ds.fieldBadge}>
              <span className={COMMERCIAL_CLASS[organization.commercialStatus]}>OSC · {COMMERCIAL_BADGE_LABEL[organization.commercialStatus]}</span>
            </div>
          </Field>
          <Field label="Administrador único">
            <div className={ds.fieldValue}>{administrator}</div>
          </Field>
          <Field label="Vínculo do usuário">
            <div className={ds.fieldValue}>{AUTHORITY_LABEL[authority]}</div>
          </Field>
        </div>
      </section>

      <section className={ds.card} aria-labelledby="osc01-permissoes">
        <h2 id="osc01-permissoes" className={ds.sectionTitle}>
          Suas permissões operacionais
        </h2>
        {membership.permissions.length === 0 ? (
          <p className={ds.muted}>Nenhuma permissão operacional concedida nesta OSC.</p>
        ) : (
          PERMISSION_MODULES.filter((module) => membership.permissions.some((p) => p.startsWith(`${module.id}.`))).map((module) => (
            <div key={module.id} className={ds.stack}>
              <span className={ds.fieldLabel}>{module.label}</span>
              <ul className={ds.chips} aria-label={module.label}>
                {membership.permissions
                  .filter((p) => p.startsWith(`${module.id}.`))
                  .map((p) => (
                    <li key={p} className={ds.badgeGranted}>
                      <CheckIcon />
                      {permissionLabel(p)}
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
        <p className={ds.meta}>
          {authority === 'administrator'
            ? 'A função de administrador único não inclui permissões operacionais implícitas. '
            : ''}
          As permissões operacionais valem para todas as parcerias desta OSC e não se aplicam a outras OSCs.
        </p>
      </section>

      <section className={ds.card} aria-labelledby="osc01-acoes" style={{ gap: 12 }}>
        <h2 id="osc01-acoes" className={ds.sectionTitle}>
          Ações disponíveis
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="button" className={ds.primary} onClick={onConsultPartnerships}>
            Consultar parcerias
          </button>
          {canManagePermissions ? (
            <button type="button" className={ds.secondary} onClick={onUsersAndPermissions}>
              Usuários e permissões
            </button>
          ) : null}
        </div>
      </section>
    </>
  )
}
