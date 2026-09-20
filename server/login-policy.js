import { MATCHER_VERSION } from './matching/index.js';
import { PASSIVE_VERSION } from './passive.js';
import { ATTACKS } from './evaluation.js';

export const LOGIN_POLICY_VERSION='login-policy-1';
export function loginReportIssues(report){
  const issues=[],test=report?.test,baseline=report?.baselineTest,p=report?.policy;
  if(report?.schemaVersion!==1||report?.mode!=='login'||report?.policyVersion!==LOGIN_POLICY_VERSION)issues.push('Unsupported login report');
  if(report?.origin!=='recorded'||report?.sessionSeparated!==true)issues.push('Recorded, session-separated data required');
  if(report?.matcherVersion!==MATCHER_VERSION||report?.passiveVersion!==PASSIVE_VERSION)issues.push('Matcher version mismatch');
  if(!Number.isInteger(report?.users)||report.users<2)issues.push('At least two enrolled users required');
  if(!p||!Number.isFinite(p.passiveThreshold)||p.passiveThreshold<.3||p.passiveThreshold>.99||!Number.isFinite(p.finalThreshold)||p.finalThreshold<.3||p.finalThreshold>.99||!Number.isFinite(p.passiveWeight)||p.passiveWeight<.1||p.passiveWeight>.5)issues.push('Unsupported calibrated parameters');
  const measured=m=>m&&Number.isFinite(m.FAR)&&m.FAR>=0&&m.FAR<=1&&Number.isFinite(m.FRR)&&m.FRR>=0&&m.FRR<=1&&Number.isInteger(m.genuine)&&m.genuine>0&&Number.isInteger(m.impostors)&&m.impostors>0;
  if(!measured(report?.validation)||!measured(test)||!measured(baseline))issues.push('Missing genuine/impostor measurements');
  else if(test.FAR>baseline.FAR||test.FRR>baseline.FRR)issues.push('Calibrated policy regresses held-out FAR or FRR');
  if(!report?.perUser||Object.keys(report.perUser).length!==report.users||Object.values(report.perUser).some(m=>!measured(m)))issues.push('Every enrolled user needs genuine and impostor test attempts');
  if(ATTACKS.some(a=>!(report?.attacks?.[a]?.impostors>0)))issues.push('All attack categories need held-out coverage');
  if(report?.ambientEvaluated===true){
    const a=report?.ambient;
    if(!Number.isFinite(p?.ambientWeight)||p.ambientWeight<.05||p.ambientWeight>.5)issues.push('Ambient-evaluated reports need a calibrated ambientWeight between 0.05 and 0.5');
    if(!a||!measured(a.disabledTest))issues.push('Ambient-evaluated reports need an ambient-disabled held-out comparison');
    else if(Number.isFinite(test?.FAR)&&test.FAR>a.disabledTest.FAR)issues.push('Ambient evidence raised held-out FAR, which contradicts its construction');
    if(!(a?.attemptsWithAmbient>0))issues.push('Ambient-evaluated reports need held-out attempts carrying ambient windows');
  }
  if(!report?.activePolicy||typeof report.activePolicy.advanced!=='boolean'||report.activePolicy.advanced&&(!Number.isFinite(report.activePolicy.identityThreshold)||report.activePolicy.identityThreshold<.25||report.activePolicy.identityThreshold>.99))issues.push('Missing active-policy configuration');
  return issues;
}
