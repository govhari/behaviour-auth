import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { MATCHER_VERSION } from './matching/index.js';
import { loginReportIssues } from './login-policy.js';
export function loadPolicy(path){
  if(!path)return {};
  const policy=JSON.parse(readFileSync(path,'utf8'));
  const result={};
  if(policy.advanced||policy.adaptation){
  const report=JSON.parse(readFileSync(resolve(dirname(path),policy.report),'utf8'));
  if(report.matcherVersion!==MATCHER_VERSION||!report.advancedEligible||report.origin!=='recorded'||!report.sessionSeparated)throw Error('Policy requires an eligible recorded-session evaluation report');
  const threshold=report.variants?.F?.threshold;
  if(!Number.isFinite(threshold)||threshold<.25||threshold>.99)throw Error('Evaluation threshold is outside the supported range');
  if(policy.adaptation&&(!policy.advanced||!(Number.isFinite(policy.maximumFAR)&&policy.maximumFAR>=0&&policy.maximumFAR<=.05)||report.variants.F.test.FAR>policy.maximumFAR))throw Error('Adaptation requires advanced mode and an explicit measured FAR ceiling (0 to 0.05)');
  Object.assign(result,{advanced:!!policy.advanced,adaptation:!!policy.adaptation,identityThreshold:threshold});
  }
  if(policy.login){
    if(typeof policy.loginReport!=='string')throw Error('loginReport is required');
    const report=JSON.parse(readFileSync(resolve(dirname(path),policy.loginReport),'utf8')),issues=loginReportIssues(report);
    if(issues.length)throw Error('Login policy refused: '+issues.join('; '));
    if(report.activePolicy.advanced!==!!result.advanced||result.advanced&&report.activePolicy.identityThreshold!==result.identityThreshold)throw Error('Login report must use the exact deployed active policy');
    if(!Number.isFinite(policy.maximumLoginFAR)||policy.maximumLoginFAR<0||policy.maximumLoginFAR>.05||report.test.FAR>policy.maximumLoginFAR)throw Error('Set maximumLoginFAR (0 to 0.05) and meet its held-out ceiling');
    if(!Number.isInteger(policy.minimumLoginGenuine)||policy.minimumLoginGenuine<1||!Number.isInteger(policy.minimumLoginImpostors)||policy.minimumLoginImpostors<1||report.test.genuine<policy.minimumLoginGenuine||report.test.impostors<policy.minimumLoginImpostors)throw Error('Explicit minimumLoginGenuine/minimumLoginImpostors sample counts are required and must be met');
    const {passiveThreshold,finalThreshold,passiveWeight,ambientWeight}=report.policy;
    Object.assign(result,{passiveThreshold,finalThreshold,passiveWeight,loginCalibrated:true,passiveAdaptation:policy.passiveAdaptation===true});
    if(policy.ambient===false)result.ambient=false;
    else if(policy.ambient===true){
      if(report.ambientEvaluated!==true)throw Error('Setting ambient:true requires a login report that measured ambient evidence');
      result.ambientWeight=ambientWeight;
    }
    if(policy.ambientMismatchMargin!==undefined){
      if(!Number.isFinite(policy.ambientMismatchMargin)||policy.ambientMismatchMargin<0||policy.ambientMismatchMargin>.3)throw Error('ambientMismatchMargin must be between 0 and 0.3');
      result.ambientMismatchMargin=policy.ambientMismatchMargin;
    }
  }else if(policy.passiveAdaptation)throw Error('Passive adaptation requires an approved calibrated login policy');
  else if(policy.ambient===false)result.ambient=false;
  return result;
}
