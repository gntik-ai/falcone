export function seedPlanHistoryFixture() {
  return {
    tenantId: 'acme-corp',
    starterPlanId: 'pln_starter',
    professionalPlanId: 'pln_professional',
    actorId: 'usr_superadmin',
    transitions: ['upgrade', 'downgrade', 'lateral', 'equivalent']
  };
}
