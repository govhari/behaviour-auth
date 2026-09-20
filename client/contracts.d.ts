export type Decision = 'ACCEPT' | 'REJECT' | 'MORE_DATA' | 'SAMPLE_ACCEPTED' | 'STEP_UP';
export type Event = { t: number; trusted?: boolean } & (
  { type:'text'; value:string } |
  { type: 'keydown' | 'keyup'; key: string } |
  { type: 'move' | 'down' | 'up'; x: number; y: number; pointerType?:'mouse'|'touch'|'pen'; pressure?:number; width?:number; height?:number; tiltX?:number; tiltY?:number; twist?:number } |
  { type:'scroll'|'scrollselect'; position:number } |
  { type:'wheel'; deltaX:number;deltaY:number;deltaMode:0|1|2 } |
  { type:'focus'; active:boolean } |
  { type:'motion'; x:number; y:number; z:number;ax?:number;ay?:number;az?:number } |
  { type:'gyro'; x:number;y:number;z:number }
);
export interface DeviceContext { installId?:string; class?:'desktop-pointer'|'touch'|'pen'; scroll?:boolean }
export type Modality = 'keyboard'|'pointer'|'touch'|'pen'|'scroll'|'motion'|'crossModal'|'username'|'password'|'click';
export interface Challenge {
  challengeId: string; nonce: string; userId: string; purpose: 'enroll' | 'auth';
  enrollmentId: string | null; phrase: string; targets: {x:number;y:number;radius?:number}[];
  issuedAt: number; expiresAt: number;
  device?:{id:string;class:string;scroll:boolean}; bootstrap?:boolean; scrollTarget?:number|null;
  interaction?:'point'|'drag'; dragStart?:{x:number;y:number};
  loginAttemptId?:string;
}
export interface PassiveChallenge {
  challengeId:string; nonce:string; userId:string; purpose:'passive-enroll'|'passive-auth';
  issuedAt:number; expiresAt:number; enrollmentId:string|null;
  device:{id:string;class:string;scroll:boolean};
}
export type PassiveEvent = {t:number;trusted?:boolean} & (
  {type:'keydown'|'keyup';field:'username';position:number;action:'character'|'correction'|'modifier'|'navigation';key:string;code?:string} |
  {type:'keydown'|'keyup';field:'password';position:number;action:'character'|'correction'|'modifier'|'navigation';key?:never;code?:never;value?:never} |
  {type:'move'|'down'|'up';x:number;y:number;target:'username'|'password'|'submit'|'form';pointerType?:'mouse'|'touch'|'pen';buttonX?:number;buttonY?:number} |
  {type:'focus';field:'username'|'password'|'form';active:boolean} |
  {type:'input';field:'username'|'password';source:'typing'|'autofill'|'composition'} |
  {type:'submit';method:'pointer'|'keyboard'} | {type:'cancel'}
);
export interface PassiveEvidence {challengeId:string;nonce:string;userId:string;username:string;events:PassiveEvent[];studySessionId?:string|null;hints?:{webdriver?:boolean};enrollmentToken?:string;ambientId?:string|null}
export interface ProfileStatus {enrolled:boolean;passiveEnrolled:boolean;passiveRounds:number;passiveFeatureSchemaVersion:number|null;passiveMatcherVersion:string|null;passiveMigrationRequired:boolean;profileVersion:number|null;featureSchemaVersion:number;matcherVersion:string;matcherMode:'advanced'|'shadow';trustedDevices:number;adaptation:'quarantined'|'disabled';passiveAdaptation:'quarantined'|'disabled';loginPolicy:'calibrated'|'provisional';ambientEnrolled:boolean;ambientWindows:number;ambientClass:string|null;ambientFeatureSchemaVersion:number|null;ambientMatcherVersion:string|null;ambientMigrationRequired:boolean;provisional:true}
export interface EnrollmentCredentials {enrollmentId:string;enrollmentToken:string;roundsAccepted?:number}
export interface EnrollmentFlow {deviceOnly?:boolean;activeEnrollment:EnrollmentCredentials|null;activeComplete:boolean;passiveEnrollment:EnrollmentCredentials;passiveRoundsRequired:number;passiveRoundsAccepted:number}
export interface Evidence { challengeId:string; nonce:string; userId:string; events:Event[]; enrollmentToken?:string; studySessionId?:string|null }
export interface Result {
  decision: Decision; allowed: boolean; reasons: string[]; identityScore?: number | null;
  humanScore?: number; quality?: number; fresh?: boolean; provisional?: boolean;
  roundsAccepted?: number; threshold?: number; modalities?: Partial<Record<Modality,number|null>>;
  featureSchemaVersion?:number; evidenceQuality?:Partial<Record<Modality,number>>;
  availability?:Partial<Record<Modality,'AVAILABLE'|'UNAVAILABLE'>>; verificationMs?:number;
  baselineScore?:number; deviceState?:'trusted'|'candidate'|'unknown';
  advanced?:{mode:'active'|'shadow';score:number|null;complete:boolean;exemplarCount:number;modalities:Partial<Record<Modality,number|null>>;matcherVersion?:string};
  adaptation?:{state:'disabled'|'ineligible'|'waiting'|'inconsistent'|'quarantined'|'promoted';samples?:number;required?:number;reason?:string};
  phase?:'passive'|'active'|'final';password?:'PASS'|'FAIL'|'TRAINING';
  activeRequired?:boolean;loginId?:string;sessionId?:string;passive?:Result;active?:Result;
  observedQuality?:number;qualityMinimum?:number;humanMinimum?:number;signals?:string[];
  fusionWeights?:{passive:number;active:number};
  passiveAdaptation?:{state:string;samples?:number;required?:number;reason?:string};
  ambient?:AmbientEvidence|null;fusedIdentityScore?:number|null;
  renewals?:number;expiresAt?:number;reauthenticationRequired?:boolean;matcherVersion?:string;
}
export type AmbientEvent = {t:number;trusted?:boolean} & (
  {type:'keydown'|'keyup';position:number;action:'character'|'correction'|'modifier'|'navigation';key?:never;code?:never;value?:never} |
  {type:'move'|'down'|'up';x:number;y:number;pointerType?:'mouse'|'touch'|'pen'} |
  {type:'scroll';position:number} |
  {type:'wheel';deltaY:number;deltaMode:0|1|2} |
  {type:'focus';active:boolean} |
  {type:'view';view:string}
);
export type AmbientModality='keyboard'|'pointer'|'click'|'scroll'|'crossModal'|'rhythm';
export interface AmbientSession {ambientId:string;nonce:string;windowMs:number;expiresAt:number;maxWindows:number;provisional:true}
export interface AmbientIngest {ambientId:string;nonce:string;events:AmbientEvent[];studySessionId?:string|null;hints?:{webdriver?:boolean}}
export interface AmbientIngestResult {accepted:boolean;nonce:string;windows:number;quality?:number;humanScore?:number;availability?:Partial<Record<AmbientModality,'AVAILABLE'|'UNAVAILABLE'>>;reasons:string[];provisional:true}
export interface AmbientEvidence {
  identityScore:number|null;rawScore:number|null;quality:number|null;observedQuality:number|null;humanScore:number|null;
  windows:number;span:number;threshold:number;compatible:boolean;weight:number;used:boolean;
  modalities:Partial<Record<AmbientModality,number|null>>;evidenceQuality:Partial<Record<AmbientModality,number>>;
  availability:Partial<Record<AmbientModality,'AVAILABLE'|'UNAVAILABLE'>>;signals:string[];reasons:string[];matcherVersion:string|null;
}
export type ContinuousEvent={t:number;trusted?:boolean}&({type:'keydown'|'keyup';position:number;key?:never;code?:never;value?:never}|{type:'move'|'down'|'up';x:number;y:number}|{type:'focus';active:boolean});
export interface MonitorChallenge {challengeId:string;nonce:string;userId:string;monitorId:string;purpose:'continuous';issuedAt:number;expiresAt:number}
export interface MonitorSession {monitorId:string;expiresAt:number;maxExpiresAt:number;windowMs:number;provisional:true}
export interface MonitorEvidence {challengeId:string;nonce:string;userId:string;monitorId:string;events:ContinuousEvent[];hints?:{webdriver?:boolean}}
export interface MonitorResult {decision:'OBSERVE'|'MORE_DATA'|'STEP_UP'|'REJECT';allowed:false;reauthenticationRequired:boolean;identityScore?:number|null;quality?:number;humanScore?:number;fresh?:boolean;signals?:string[];reasons:string[];provisional:true}

export interface StepUpPresenter {
  mount(element: HTMLElement, context:{challenge:Challenge; reasons:string[]}): void;
  dismiss?(): void;
}
export interface AmbientState {
  running:boolean; windows:number; stopped?:boolean; reason?:string;
  quality?:number; reasons?:string[]; error?:string;
}
export interface BioPrintOptions {
  endpoint?:string; deviceClass?:'desktop-pointer'|'touch'|'pen';
  /** An opaque label for the current route. Never a URL. */
  view?:string|null;
  ambient?:boolean; ambientRoot?:Document|HTMLElement; studySessionId?:string|null;
  stepUp?:StepUpPresenter|null;
  onAmbient?(state:AmbientState):void; onError?(error:Error):void;
}
export interface LoginFormElements {
  form:HTMLFormElement; username:HTMLInputElement; password:HTMLInputElement; submit:HTMLElement;
  userId?:string|null; autoIdentify?:boolean;
}
export type LoginOutcome = Result & {unavailable?:boolean};
export interface LoginHandle {
  identify(userId:string):Promise<{ok:boolean;userId:string;reason:string|null}>;
  claimed():string|null;
  submit(input?:{password?:string;event?:Event|null;onStepUp?(result:Result):void}):Promise<LoginOutcome>;
  cancel():void;
}
export interface EnrollmentProgress {
  stage:'passive'|'active'|'ready';
  passive:{done:number;required:number}; active:{done:number;required:number};
  deviceOnly:boolean;
}
export interface EnrollmentWizard {
  userId:string; flow:EnrollmentFlow; progress():EnrollmentProgress;
  passiveRound(elements:LoginFormElements&{expectedText?:string|null}):Promise<{
    challenge:PassiveChallenge; cancel():void;
    submit(event?:Event|null):Promise<Result&{progress:EnrollmentProgress}>;
  }>;
  activeRound(options?:{mount?:HTMLElement;title?:string}):Promise<{
    challenge:Challenge; element:HTMLElement; focus():void; destroy():void;
    submit():Promise<Result&{progress:EnrollmentProgress}>;
  }>;
  complete():Promise<{enrolled:boolean;progress:EnrollmentProgress;ambient?:{enrolled:boolean;windows:number;required:number;reason:string|null}}>;
}
export interface MonitorHandle {stop(reason?:string):void; running():boolean}
export interface BioPrintClient {
  sdk:unknown;
  startAmbient():Promise<unknown>; stopAmbient():void;
  ambientId():string|null; ambient():AmbientState;
  setView(token:string):void;
  status(userId:string):Promise<ProfileStatus>;
  watchLogin(elements:LoginFormElements):LoginHandle;
  runStepUp(userId:string,passiveResult:Result):Promise<Result>;
  beginEnrollment(options:{userId:string;key?:string;device?:boolean}):Promise<EnrollmentWizard>;
  startMonitoring(options:{userId:string;loginId:string;roots?:(Document|HTMLElement)[];windowMs?:number;
    onWindow?(result:MonitorResult):void;onReauthentication?(result:MonitorResult):void;onStopped?(reason:string):void}):MonitorHandle;
}
export function createBioPrint(options?:BioPrintOptions):BioPrintClient;

export interface StepUpWidget {
  element:HTMLElement;
  done:Promise<Evidence|null>;
  focus():void; cancel():void; destroy():void;
}
export function createStepUp(sdk:unknown,challenge:Challenge,options?:{
  mount?:HTMLElement|null; title?:string; note?:string|null; studySessionId?:string|null;
  cancellable?:boolean; onProgress?(state:{ready:boolean;target:number;error?:string}):void;
}):StepUpWidget;

export interface HandlerOptions {
  verifyPassword?(user:string,password:unknown):boolean|Promise<boolean>;
  basePath?:string; allowedOrigins?:string[]|((origin:string)=>boolean)|null;
  serveDemo?:boolean;
  authorizeEnrollment?(req:unknown,body:Record<string,unknown>):boolean|Promise<boolean>;
  onDecision?(context:{req:unknown;res:unknown;route:string;body:Record<string,unknown>;result:Result;session:string}):void|Promise<void>;
  rateLimit?:{max:number;windowMs:number};
  crossSite?:boolean; csrf?:boolean; secureCookies?:boolean;
}
