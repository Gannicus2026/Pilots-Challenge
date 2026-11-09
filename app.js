// Configura estos dos valores con los datos de tu proyecto Supabase.

const SUPABASE_URL = "https://biyeqyvllisutwtukrov.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hyQE25aZ6fybAqcIxZ5fhw_xfX0hSHn";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.startsWith("PEGA_");
// Capture recovery intent before the SDK consumes and clears the URL fragment.
const authParams = new URLSearchParams(location.hash.slice(1));
let recovering = authParams.get("type") === "recovery" || authParams.has("error") || new URLSearchParams(location.search).get("recovery") === "1";
let recoveryReady = false;
const recoveryStorageKey = "pilots-password-recovery";
const db = configured ? window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY) : null;
let user=null, participant=null, currentQuestions=[], selectedAnswer=null, currentGame=null;
const $=id=>document.getElementById(id);
const show=(id)=>$(id).hidden=false, hide=(id)=>$(id).hidden=true;
const msg=(id,s)=>$(id).textContent=s;
function needConfig(){if(!db){alert("Falta configurar Supabase. Sigue los pasos del archivo README.");return false}return true}
function resetScreen(){
  photoConsent=false;stopBlockClock();stopCamera();capturedPhotos.clear();pageVersion++;questionCache=[];challengeCache=[];
  if(typeof $("qGame").onchange==="function")clearQuestion();
  clearChallenge();$("newPasswordForm").reset();
  ["setup","participant","adminLogin","admin","game","passwordRecovery"].forEach(hide);
  participant=null; user=null; currentQuestions=[]; selectedAnswer=null; currentGame=null;
  msg("who", ""); msg("myScore", "0");
  ["questionList","challengeList","pending","adminRanking","game"].forEach(id=>$(id).textContent="");
  $("adminPassword").value="";
}
function cleanAuthUrl(){
  const url=new URL(location.href); url.hash="";
  ["recovery","code","error","error_code","error_description"].forEach(key=>url.searchParams.delete(key));
  history.replaceState(null,"",url.pathname+url.search);
}
function recoveryScreen(ready){
  recoveryReady=ready; resetScreen(); show("passwordRecovery");
  $("savePassword").disabled=!ready;
  msg("recoveryMsg",ready?"Ingresa y confirma tu nueva contraseña.":"El enlace no es válido o ha vencido. Solicita uno nuevo desde Acceso organizador.");
}
async function session(){
  if(!needConfig())return;
  try {
    const {data,error}=await db.auth.getSession();
    if(recovering || sessionStorage.getItem(recoveryStorageKey)){
      recovering=true;
      // The recovery event (or this tab's pending marker) must precede password entry.
      recoveryScreen(!error && !!data.session && (recoveryReady || !!sessionStorage.getItem(recoveryStorageKey)));
      cleanAuthUrl(); return;
    }
    resetScreen();
    if(error)throw error;
    if(!data.session){show("setup");return}
    user=data.session.user;
    if(user.is_anonymous){await loadParticipant();if(!participant)show("setup");return}
    const {data:admin,error:adminError}=await db.rpc("is_admin");
    if(adminError)throw adminError;
    if(admin){show("admin");msg("who","Organizador");await loadAdmin()}
    else {show("adminLogin");msg("adminMsg","Esta cuenta no tiene permisos de organizador.")}
  } catch {show("adminLogin");msg("adminMsg","No se pudo restaurar la sesión. Intenta ingresar nuevamente.")}
}
async function closeSession(){
  if(participant && !confirm("Al cerrar esta sesión anónima no podrás volver a entrar con este mismo participante. Su puntaje y registros se conservarán. ¿Cerrar sesión?"))return;
  const {error}=await db.auth.signOut({scope:"local"});
  if(error){alert("No se pudo cerrar la sesión. Intenta nuevamente.");return false}
  sessionStorage.removeItem(recoveryStorageKey);recovering=false;recoveryReady=false;
  resetScreen();show("setup");return true;
}
$("participantSignOut").onclick=closeSession;
$("adminSignOut").onclick=closeSession;
$("loginBack").onclick=()=>{hide("adminLogin");show(participant?"participant":"setup")};
$("forgotPassword").onclick=async()=>{
  const email=$("adminEmail");if(!email.value.trim() || !email.reportValidity()){msg("adminMsg","Ingresa un correo válido para solicitar la recuperación.");return}
  $("forgotPassword").disabled=true;
  try{
    const redirect=new URL(location.pathname,location.origin);
    const {error}=await db.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:redirect.href});
    msg("adminMsg",error?"No se pudo enviar el enlace. Espera unos minutos e intenta nuevamente.":"Si el correo tiene una cuenta, recibirás un enlace para establecer una nueva contraseña.");
  }catch{msg("adminMsg","No se pudo conectar. Intenta nuevamente.")}
  finally{$("forgotPassword").disabled=false}
};
$("newPasswordForm").onsubmit=async event=>{
  event.preventDefault();if(!recoveryReady)return;
  const password=$("newPassword").value;
  if(password.length<12){msg("recoveryMsg","Usa al menos 12 caracteres.");return}
  if(password!==$("confirmPassword").value){msg("recoveryMsg","Las contraseñas no coinciden.");return}
  $("savePassword").disabled=true;
  try{
    const {data,error:sessionError}=await db.auth.getUser();
    if(sessionError || !data.user || data.user.is_anonymous){recoveryScreen(false);return}
    const {error}=await db.auth.updateUser({password});
    if(error){msg("recoveryMsg",error.code==="same_password"?"Elige una contraseña diferente de la anterior.":"No se pudo actualizar. Comprueba los requisitos de contraseña o solicita un enlace nuevo.");return}
    $("newPasswordForm").reset();
    sessionStorage.removeItem(recoveryStorageKey);recovering=false;recoveryReady=false;cleanAuthUrl();
    const {error:logoutError}=await db.auth.signOut({scope:"local"});
    resetScreen();show("adminLogin");
    msg("adminMsg",logoutError?"Contraseña actualizada. Cierra la sesión antes de compartir este dispositivo.":"Contraseña actualizada. Ya puedes ingresar como organizador.");
  }catch{msg("recoveryMsg","No se pudo conectar. Intenta nuevamente.")}
  finally{$("savePassword").disabled=!recoveryReady}
};
$("cancelRecovery").onclick=async()=>{if(await closeSession()){$("newPasswordForm").reset();cleanAuthUrl();hide("setup");show("adminLogin")}};
if(db)db.auth.onAuthStateChange((event,session)=>{
  // Do not await Supabase calls inside this synchronous listener (Auth lock).
  if(event==="PASSWORD_RECOVERY"){
    recovering=true;sessionStorage.setItem(recoveryStorageKey,"pending");
    recoveryScreen(!!session);cleanAuthUrl();
  }else if(event==="SIGNED_OUT"){
    sessionStorage.removeItem(recoveryStorageKey);recovering=false;recoveryReady=false;
    resetScreen();show("setup");
  }
});
// Gameplay uses only public projections and server-side scoring RPCs.
let pageVersion=0, rankRole="", questionCache=[], challengeCache=[];
const letters=["A","B","C","D"];
const connectionMessage="No se pudo conectar. Intenta nuevamente.";
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c]))}
function optionsFor(question){
  const keys=question.game==="tf"?["V","F"]:letters;
  if(Array.isArray(question.options))return question.options.map((option,i)=>{
    if(typeof option==="string")return [keys[i]||String(i+1),option];
    return [String(option?.key||option?.id||keys[i]||i+1),String(option?.text||option?.label||option?.value||"")];
  }).filter(([,text])=>text.trim());
  return Object.entries(question.options||{}).filter(([,text])=>String(text).trim());
}
function validPoints(value){return Number.isInteger(Number(value)) && Number(value)>=1 && Number(value)<=1000}
async function busy(button,action){
  if(button.disabled)return;button.disabled=true;
  try{await action()}catch{alert(connectionMessage)}finally{button.disabled=false}
}
async function loadParticipant(){
  const id=user?.id;if(!id)return;
  const {data,error}=await db.from("participants").select("*").eq("id",id).maybeSingle();
  if(user?.id!==id)return;
  if(error)throw error;
  if(data){participant=data;hide("setup");show("participant");hide("adminLogin");hide("admin");
    msg("hello",`¡Vamos, ${data.nickname}!`);msg("who",`${data.nickname} · ${data.role}`);msg("myScore",data.points)}
}
async function refreshScore(){
  const id=user?.id;if(!participant || !id)return;
  const {data}=await db.from("participants").select("points").eq("id",id).single();
  if(data && participant?.id===id){participant.points=data.points;msg("myScore",data.points)}
}
$("join").onclick=()=>busy($("join"),async()=>{
  if(!needConfig())return;
  const nickname=$("nickname").value.trim(),role=$("role").value;
  if(nickname.length<2 || nickname.length>24 || !["FO","CT"].includes(role)){msg("setupMsg","Usa un pseudónimo de 2 a 24 caracteres y elige FO o CT.");return}
  msg("setupMsg","Ingresando…");
  try{
    // Reuse an anonymous session left by an interrupted registration.
    const {data:existing,error:sessionError}=await db.auth.getSession();if(sessionError)throw sessionError;
    if(existing.session?.user && !existing.session.user.is_anonymous){msg("setupMsg","Cierra la sesión de organizador antes de entrar como participante.");return}
    if(existing.session)user=existing.session.user;
    else {const {data,error}=await db.auth.signInAnonymously();if(error)throw error;user=data.user}
    await loadParticipant();if(participant)return;
    const {error}=await db.rpc("register_participant",{p_nickname:nickname,p_role:role});
    if(error){msg("setupMsg","No se pudo completar el registro. Intenta nuevamente.");return}
    await loadParticipant();msg("setupMsg","");
  }catch{msg("setupMsg",connectionMessage)}
});
function closeGame(){stopBlockClock();stopCamera();pageVersion++;hide("game")}
document.querySelectorAll(".tile").forEach(button=>button.onclick=()=>openPage(button.dataset.page));
function backButton(id="gameBack"){return `<button class="secondary" id="${id}">Volver al menú</button>`}
function gameError(text){$("game").innerHTML=`<p role="status">${escapeHtml(text)}</p>${backButton()}`;$("gameBack").onclick=closeGame}
async function openPage(page){
  if(!participant || !needConfig())return;
  stopBlockClock();stopCamera();currentGame=page;rankRole="";const version=++pageVersion;show("game");$("game").innerHTML='<p class="muted" role="status">Cargando…</p>';
  try{
    if(page==="ranking"){await renderRanking();await refreshScore();return}
    if(page==="objects"){await renderChallenges();return}
    if(!["trivia","tf"].includes(page))return;
    const id=user.id;
    const [questions,attempts]=await Promise.all([
      db.from("public_questions").select("*").eq("game",page).order("level").order("created_at"),
      db.from("answer_attempts").select("question_id").eq("participant_id",id)
    ]);
    if(version!==pageVersion || user?.id!==id)return;
    if(questions.error || attempts.error){gameError("No se pudieron cargar las preguntas y tu progreso. Intenta nuevamente.");return}
    const answered=new Set((attempts.data||[]).map(a=>a.question_id));
    currentQuestions=questions.data||[];
    if(page==="trivia"){
      $("game").innerHTML='<h2>Elige el nivel de trivia</h2><p class="muted">Los nombres indican la dificultad. Todos pueden jugar Trivia Nivel FO, Trivia Nivel CT y Trivia Nivel Gerencia, sin importar el cargo registrado. Cada bloque puntúa una sola vez.</p><div class="answers">'+["FO","CT","Gerencia"].map((label,i)=>`<button data-level="${i+1}">Trivia Nivel ${label} · ${currentQuestions.filter(q=>q.level===i+1 && !answered.has(q.id)).length} pendientes</button>`).join("")+`</div>${backButton()}`;
      $("game").querySelectorAll("[data-level]").forEach(b=>b.onclick=()=>prepareBlock(Number(b.dataset.level)));
      $("gameBack").onclick=closeGame;
    }else prepareBlock(1);
  }catch{if(version===pageVersion)gameError(connectionMessage)}
}
let blockClock=null;
function stopBlockClock(){if(blockClock!==null)clearInterval(blockClock);blockClock=null}
function formatElapsed(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`}
function startBlockClock(state){
  stopBlockClock();const anchor=Date.now(),elapsed=Number(state.elapsed_seconds)||0;
  const tick=()=>{const label=$("blockElapsed");if(label)label.textContent=formatElapsed(elapsed+(Date.now()-anchor)/1000)};
  tick();blockClock=setInterval(tick,1000);
}
function prepareBlock(level){
  const title=currentGame==="tf"?"Verdadero o Falso":["","Trivia Nivel FO","Trivia Nivel CT","Trivia Nivel Gerencia"][level];
  $("game").innerHTML=`<h2>${title}</h2><p>El tiempo empieza al pulsar Comenzar. Si ya iniciaste este bloque, continuará desde el inicio original.</p><p>Los aciertos mantienen su puntaje. Al completar el bloque obtienes hasta un 50 % adicional sobre esos puntos: bono completo hasta 3 minutos, que disminuye gradualmente hasta cero a los 15 minutos.</p><p class="muted">Salir o recargar no pausa el tiempo. Cada bloque y su bono puntúan una sola vez.</p><button id="beginBlock">Comenzar / continuar bloque</button>${backButton()}`;
  $("beginBlock").onclick=()=>busy($("beginBlock"),()=>startQuestionSet(level));$("gameBack").onclick=closeGame;
}
function renderBlockResult(state){
  stopBlockClock();
  $("game").innerHTML=`<h2>¡Bloque terminado!</h2><p>Aciertos: ${Number(state.correct)} de ${Number(state.total)}.</p><p>Tiempo total: ${formatElapsed(state.elapsed_seconds)}.</p><p>Puntos por aciertos: <b>${Number(state.base_points)}</b>.</p><p>Bono por tiempo: <b>+${Number(state.bonus_points)}</b>.</p><p>Total del bloque: <b>${Number(state.base_points)+Number(state.bonus_points)} puntos</b>.</p>${state.bonus_eligible?"":'<p class="muted">Este bloque comenzó con el sistema anterior y conserva sus puntos por aciertos, sin bono retroactivo.</p>'}${backButton()}`;
  $("gameBack").onclick=closeGame;
}
async function startQuestionSet(level){
  const game=currentGame,version=pageVersion;
  const {data:state,error}=await db.rpc("start_block",{p_game:game,p_level:level});
  if(version!==pageVersion || !participant)return;
  if(error || !state){gameError("No se pudo iniciar el bloque. Intenta nuevamente.");return}
  if(state.finished){renderBlockResult(state);await refreshScore();return}
  const qs=state.questions||[];let index=0;
  if(!qs.length){gameError("No hay preguntas disponibles en este bloque.");return}
  const render=()=>{
    const q=qs[index];selectedAnswer=null;
    $("game").innerHTML=`<p class="eyebrow">${game==="tf"?"VERDADERO O FALSO":"TRIVIA NIVEL "+["","FO","CT","GERENCIA"][q.level]}</p><p class="muted">Tiempo del bloque: <b id="blockElapsed"></b> · Bono máximo: +50 %</p><h2>${escapeHtml(q.question)}</h2><div class="answers">${optionsFor(q).map(([key,text])=>`<button data-answer="${escapeHtml(key)}"><b>${escapeHtml(key)}.</b> ${escapeHtml(text)}</button>`).join("")}</div><p class="muted">Pregunta ${Number(state.answered)+index+1} de ${Number(state.total)}</p><button id="submitAnswer" disabled>Responder</button>${backButton()}<p id="answerMsg" class="msg" role="status"></p>`;
    // Retain the same original server anchor between questions.
    const label=$("blockElapsed");label.textContent=formatElapsed(Number(state.elapsed_seconds)+(Date.now()-state.receivedAt)/1000);
    const submit=$("submitAnswer");let submitting=false;
    $("game").querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>{
      if(submitting)return;selectedAnswer=b.dataset.answer;
      $("game").querySelectorAll("[data-answer]").forEach(x=>x.classList.toggle("selected",x===b));submit.disabled=false;
    });
    $("gameBack").onclick=closeGame;
    submit.onclick=async()=>{
      if(submitting || selectedAnswer===null)return;submitting=true;submit.disabled=true;
      try{
        const {data,error}=await db.rpc("submit_answer",{p_question_id:q.id,p_answer:selectedAnswer});
        if(version!==pageVersion || !participant)return;
        const duplicate=error && /ya respondiste/i.test(error.message||"");
        if(error && !duplicate){msg("answerMsg","No se pudo registrar la respuesta. Intenta nuevamente.");return}
        if(duplicate){await startQuestionSet(level);return}
        index++;await refreshScore();
        if(version!==pageVersion || !participant)return;
        if(data?.block?.finished)renderBlockResult(data.block);
        else if(index<qs.length)render();
        else await startQuestionSet(level);
      }catch{if(version===pageVersion)msg("answerMsg",connectionMessage)}
      finally{submitting=false;submit.disabled=false}
    };
  };
  state.receivedAt=Date.now();render();startBlockClock(state);
}
let photoConsent=false;
let photoAIReady=false;
const capturedPhotos=new Map();
let cameraStream=null,cameraChallenge=null,cameraRequest=0;
function stopCamera(){
  cameraRequest++;
  if(cameraStream)cameraStream.getTracks().forEach(track=>track.stop());
  if(cameraChallenge){const host=$(`camera-${cameraChallenge}`);if(host)host.textContent="";const button=$("game")?.querySelector?.(`[data-camera="${cameraChallenge}"]`);if(button&&!capturedPhotos.has(cameraChallenge))button.disabled=false}
  cameraStream=null;cameraChallenge=null;
}
function photoMsg(id,text){const target=$(id);if(target)target.textContent=text}
async function openCamera(challengeId){
  const feedback=`upload-${challengeId}`;
  if(!photoConsent){photoMsg(feedback,"Autoriza el análisis por Google Gemini antes de tomar la foto.");return}
  if(capturedPhotos.has(challengeId)){photoMsg(feedback,"Esta foto ya fue capturada. Espera a que se guarde o reintenta el guardado.");return}
  stopCamera();
  const request=cameraRequest,version=pageVersion,id=user?.id;
  const host=$(`camera-${challengeId}`),cameraButton=$("game").querySelector(`[data-camera="${challengeId}"]`);
  if(cameraButton)cameraButton.disabled=true;cameraChallenge=challengeId;
  if(!navigator.mediaDevices?.getUserMedia){if(cameraButton)cameraButton.disabled=false;photoMsg(feedback,"Este navegador no permite acceder a la cámara. Abre la aplicación en un navegador compatible mediante HTTPS.");return}
  photoMsg(feedback,"Abriendo cámara…");
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1600},height:{ideal:1200}},audio:false});
    if(request!==cameraRequest || version!==pageVersion || !participant){stream.getTracks().forEach(track=>track.stop());return}
    cameraStream=stream;cameraChallenge=challengeId;
    host.innerHTML='<video class="cameraPreview" autoplay muted playsinline aria-label="Vista previa de la cámara"></video><button data-shutter>Tomar foto</button><button class="secondary" data-cancel-camera>Cancelar</button>';
    const video=host.querySelector('video');video.srcObject=stream;await video.play();
    if(request!==cameraRequest)return;
    let capturing=false;const shutter=host.querySelector('[data-shutter]'),cancel=host.querySelector('[data-cancel-camera]');
    photoMsg(feedback,"");cancel.onclick=()=>{stopCamera();if(cameraButton)cameraButton.disabled=false};
    shutter.onclick=async()=>{
      if(capturing)return;
      if(!video.videoWidth || !video.videoHeight){photoMsg(feedback,"Espera a que aparezca la imagen de la cámara.");return}
      capturing=true;shutter.disabled=true;cancel.disabled=true;
      const canvas=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight));
      canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));
      if(request!==cameraRequest || user?.id!==id)return;
      if(!blob || blob.size>5*1024*1024){capturing=false;shutter.disabled=false;cancel.disabled=false;photoMsg(feedback,"No se pudo preparar la foto. Intenta tomarla nuevamente.");return}
      const capture={file:blob};capturedPhotos.set(challengeId,capture);stopCamera();
      if(version===pageVersion){host.textContent="";canvas.className="cameraPreview";canvas.setAttribute('aria-label','Fotografía capturada');host.appendChild(canvas);if(cameraButton)cameraButton.disabled=true}
      await uploadEvidence(challengeId,capture);
    };
  }catch{
    if(request===cameraRequest){stopCamera();if(cameraButton)cameraButton.disabled=false;photoMsg(feedback,"No se pudo abrir la cámara. Revisa el permiso de cámara del navegador y vuelve a intentarlo.")}
  }
}
window.addEventListener('pagehide',stopCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera()});
function photoChallengeMarkup(c,s){
  const saved=s?.status==='pending',done=s?.status==='approved',capture=capturedPhotos.get(c.id);
  const reason=s?.validation_reason?`<p class="muted">${escapeHtml(s.validation_reason)}</p>`:"";
  let controls;
  if(done)controls='<p class="photoComplete">✓ Desafío completado · puntos asignados</p><button disabled>Completado</button>';
  else if(saved)controls=`<p class="msg">✓ Foto guardada · ${photoAIReady?"lista para validación IA":"validación IA aún no activada"}</p>${reason}<button disabled>Foto capturada</button><button data-analyze="${s.id}" data-challenge="${c.id}" ${photoConsent&&photoAIReady?"":"disabled"}>Validar foto con IA</button>${s.validation_reason?`<button class="secondary" data-camera="${c.id}">Tomar otra foto</button>`:""}`;
  else if(capture)controls=`<p class="msg">✓ Foto capturada · ${capture.uploading?"guardando…":"falta completar el guardado"}</p><button disabled>Foto capturada</button><button data-save-photo="${c.id}" ${capture.uploading?"disabled":""}>Reintentar guardado</button>`;
  else controls=`${s?.status==='rejected'?'<p class="msg">La fotografía no cumple el desafío. Puedes tomar otra.</p>'+reason:""}<div id="camera-${c.id}"></div><button data-camera="${c.id}">Abrir cámara</button><button data-save-photo="${c.id}" hidden>Reintentar guardado</button>`;
  // Every path has a camera host and feedback; controls depend on persisted server status.
  if(!controls.includes(`id="camera-${c.id}"`))controls+=`<div id="camera-${c.id}"></div>`;
  return `<div class="challenge ${done?"challengeComplete":""}"><strong>${escapeHtml(c.description)}</strong><small>${c.points} puntos · sin cronómetro</small>${controls}<span class="msg" role="status" id="upload-${c.id}"></span></div>`;
}
async function renderChallenges(){
  stopCamera();
  const version=pageVersion,id=user.id;
  const [challenges,submissions,capability]=await Promise.all([
    db.from("challenges").select("*").eq("active",true).order("created_at",{ascending:false}),
    db.from("submissions").select("id,challenge_id,status,validation_reason").eq("participant_id",id),
    db.functions.invoke("validate-photo",{method:"GET"}).catch(()=>({data:{ready:false}}))
  ]);
  if(version!==pageVersion || user?.id!==id)return;
  if(challenges.error || submissions.error){gameError("No se pudieron cargar los desafíos. Intenta nuevamente.");return}
  photoAIReady=capability.data?.ready===true;
  const statuses=new Map((submissions.data||[]).map(s=>[s.challenge_id,s]));
  const g=$("game");
  g.innerHTML='<h2>¿Quién tiene…?</h2><p>Sin límite de tiempo. Puedes salir, jugar otros ítems y volver; las fotos guardadas y los desafíos completados se conservan.</p><p class="muted">Toma la fotografía ahora con la cámara. No se admite la galería. Fotografía solo el objeto o la prenda, sin caras ni documentos personales, y pide permiso a la otra persona.</p>'+(!photoAIReady?'<p class="msg">La validación IA aún requiere activación del organizador. Las fotos se guardan, pero todavía no se asignan puntos automáticos.</p>':"")+`<label class="photoConsent"><input type="checkbox" id="photoConsent" ${photoConsent?"checked":""}> Autorizo que Google Gemini analice mis fotos para validar los desafíos. Según el plan, Google puede usarlas para mejorar sus servicios. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Condiciones del proveedor</a>.</label><button class="secondary" id="refreshPhotos">Actualizar desafíos</button><p class="msg" id="photoStatus" role="status"></p>`+
    ((challenges.data||[]).map(c=>photoChallengeMarkup(c,statuses.get(c.id))).join("")||'<p class="muted">Aún no hay desafíos publicados.</p>')+backButton();
  $("photoConsent").onchange=()=>{photoConsent=$("photoConsent").checked;g.querySelectorAll('[data-analyze]').forEach(b=>b.disabled=!photoConsent||!photoAIReady)};
  g.querySelectorAll("[data-camera]").forEach(b=>b.onclick=()=>openCamera(b.dataset.camera));
  g.querySelectorAll("[data-save-photo]").forEach(b=>b.onclick=()=>uploadEvidence(b.dataset.savePhoto));
  g.querySelectorAll("[data-analyze]").forEach(b=>b.onclick=()=>busy(b,()=>analyzeEvidence(b.dataset.analyze,b.dataset.challenge)));
  $("refreshPhotos").onclick=()=>busy($("refreshPhotos"),()=>renderChallenges());$("gameBack").onclick=closeGame;
}
async function analyzeEvidence(submissionId,challengeId,uiVersion=pageVersion){
  const version=uiVersion,id=user?.id,feedback=`upload-${challengeId}`;
  if(!photoConsent){if(version===pageVersion)photoMsg(feedback,"Autoriza el análisis por Google Gemini.");return}
  if(!photoAIReady){photoMsg(feedback,"El organizador debe activar la validación IA. La foto está guardada.");return}
  photoMsg(feedback,"La IA está analizando la foto. Puedes salir y volver más tarde.");
  try{
    const {data,error}=await db.functions.invoke("validate-photo",{body:{submission_id:submissionId,consent:true}});
    if(data?.status==='approved'&&user?.id===id)await refreshScore();
    if(version!==pageVersion||user?.id!==id)return;
    if(error){let detail;try{detail=await error.context?.json()}catch{}photoMsg(feedback,detail?.message||"No se pudo completar la validación IA. La foto sigue guardada; puedes reintentar.");return}
    if(data?.status==='approved'||data?.status==='rejected'){await renderChallenges();return}
    photoMsg(feedback,data?.reason||"La foto está guardada. Actualiza los desafíos para ver el resultado.");
  }catch{if(version===pageVersion&&user?.id===id)photoMsg(feedback,"No se pudo completar la validación IA. La foto sigue guardada; puedes reintentar.")}
}
async function uploadEvidence(challengeId,capture=capturedPhotos.get(challengeId)){
  const f=capture?.file,feedback=`upload-${challengeId}`,id=user?.id,version=pageVersion;
  if(!f){photoMsg(feedback,"Toma una fotografía con la cámara.");return}
  if(capture.uploading)return;
  if(!["image/jpeg","image/png","image/webp"].includes(f.type)||f.size>5*1024*1024||f.size===0){photoMsg(feedback,"Usa una imagen JPG, PNG o WebP de máximo 5 MB.");return}
  capture.uploading=true;photoMsg(feedback,"Guardando foto… Puedes volver al menú mientras termina.");
  try{
    const pending=capture.pendingUpload;let path=pending?.file===f?pending.path:null;
    if(!path){
      const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[f.type];path=`${id}/${crypto.randomUUID()}.${ext}`;
      const {error}=await db.storage.from("evidence").upload(path,f,{upsert:false,contentType:f.type});
      if(error)throw error;capture.pendingUpload={file:f,path};
    }
    // Navigation does not cancel saving. Authorization is still enforced by the server.
    const {data,error}=await db.rpc("save_photo_submission",{p_challenge_id:challengeId,p_photo_path:path});
    if(error||!data?.id)throw error||new Error();
    capturedPhotos.delete(challengeId);
    if(version===pageVersion&&user?.id===id)await renderChallenges();
    if(photoConsent&&photoAIReady&&user?.id===id&&data.status==='pending')await analyzeEvidence(data.id,challengeId,version);
  }catch{
    if(version===pageVersion&&user?.id===id){photoMsg(feedback,"No se pudo guardar la foto. Reintenta el guardado.");const retry=$("game").querySelector(`[data-save-photo="${challengeId}"]`);if(retry){retry.hidden=false;retry.disabled=false}}
  }finally{capture.uploading=false}
}
function sortRanking(rows){return [...rows].sort((a,b)=>b.points-a.points || a.nickname.localeCompare(b.nickname,"es") || a.role.localeCompare(b.role))}
async function renderRanking(){
  const version=pageVersion;
  let query=db.from("public_ranking").select("*").order("points",{ascending:false}).order("nickname").order("role").limit(100);
  if(rankRole)query=query.eq("role",rankRole);
  const {data,error}=await query;if(version!==pageVersion)return;
  if(error){gameError("No se pudo cargar el ranking. Intenta nuevamente.");return}
  const rows=sortRanking(data||[]);
  $("game").innerHTML='<h2>Ranking de la tripulación</h2><p class="muted">Los empates comparten posición.</p><label>Mostrar<select id="rankRole"><option value="">General</option><option value="FO">FO</option><option value="CT">CT</option></select></label><button class="secondary" id="refreshRanking">Actualizar ranking</button><table><thead><tr><th>#</th><th>Pseudónimo</th><th>Cargo</th><th>Puntos</th></tr></thead><tbody>'+rows.map((p,i)=>`<tr><td>${rows.findIndex(other=>other.points===p.points)+1}</td><td>${escapeHtml(p.nickname)}</td><td><span class="tag">${escapeHtml(p.role)}</span></td><td><b>${p.points}</b></td></tr>`).join("")+`</tbody></table>${!rows.length?'<p class="muted">Sin participantes todavía.</p>':""}${backButton()}`;
  $("rankRole").value=rankRole;$("rankRole").onchange=()=>{rankRole=$("rankRole").value;renderRanking().catch(()=>gameError(connectionMessage))};
  $("refreshRanking").onclick=()=>busy($("refreshRanking"),async()=>{await renderRanking();await refreshScore()});$("gameBack").onclick=closeGame;
}
$("adminLink").onclick=async()=>{if(recovering || !$("admin").hidden)return;if(participant && !await closeSession())return;hide("setup");hide("participant");hide("game");show("adminLogin")};
$("adminSignIn").onclick=()=>busy($("adminSignIn"),async()=>{
  if(!needConfig())return;
  try{
    const {error}=await db.auth.signInWithPassword({email:$("adminEmail").value.trim(),password:$("adminPassword").value});$("adminPassword").value="";
    if(error){msg("adminMsg","No se pudo ingresar. Revisa el correo y la contraseña.");return}
    const {data:admin,error:adminError}=await db.rpc("is_admin");
    if(adminError || !admin){await db.auth.signOut({scope:"local"});hide("setup");show("adminLogin");msg("adminMsg","No se pudieron verificar los permisos de organizador.");return}
    await session();
  }catch{msg("adminMsg",connectionMessage)}
});
$("qGame").onchange=()=>{
  const tf=$("qGame").value==="tf";$("optionFields").hidden=tf;$("qLevel").disabled=tf;
  $("qCorrect").innerHTML=(tf?[["V","Verdadero"],["F","Falso"]]:letters.map(k=>[k,k])).map(([k,label])=>`<option value="${k}">${label}</option>`).join("");if(tf)$("qLevel").value="1";
};
$("saveQuestion").onclick=()=>busy($("saveQuestion"),async()=>{
  const game=$("qGame").value,options=game==="tf"?["Verdadero","Falso"]:letters.map(k=>$("opt"+k).value.trim());
  const correct=$("qCorrect").value,keys=game==="tf"?["V","F"]:letters;
  if(!$("qText").value.trim() || options.some(v=>!v) || !keys.includes(correct) || !validPoints($("qPoints").value)){
    msg("qMsg","Completa la pregunta, todas las alternativas y los puntos (entero entre 1 y 1000).");return
  }
  const row={game,level:game==="tf"?1:Number($("qLevel").value),question:$("qText").value.trim(),options,points:Number($("qPoints").value),correct_answer:correct,active:$("qActive").checked};
  try{
    const query=$("qId").value?db.from("questions").update(row).eq("id",$("qId").value):db.from("questions").insert(row);
    const {error}=await query;if(error){msg("qMsg","No se pudo guardar la pregunta. Revisa los datos e intenta nuevamente.");return}
    clearQuestion();msg("qMsg","Pregunta guardada.");await loadAdmin();
  }catch{msg("qMsg",connectionMessage)}
});
function clearQuestion(){["qId","qText","optA","optB","optC","optD"].forEach(id=>$(id).value="");$("qPoints").value=10;$("qGame").value="trivia";$("qGame").onchange();$("qLevel").value="1";$("qCorrect").value="A";$("qActive").checked=true}
$("clearQuestion").onclick=clearQuestion;
function editQuestion(q){
  $("qId").value=q.id;$("qGame").value=q.game;$("qGame").onchange();$("qLevel").value=q.level;$("qText").value=q.question;$("qPoints").value=q.points;$("qCorrect").value=q.correct_answer;$("qActive").checked=q.active;
  if(q.game==="trivia"){const opts=Object.fromEntries(optionsFor(q));letters.forEach(k=>$("opt"+k).value=opts[k]||"")}
  window.scrollTo({top:0,behavior:"smooth"});
}
$("saveChallenge").onclick=()=>busy($("saveChallenge"),async()=>{
  const description=$("challengeText").value.trim();
  if(!description || !validPoints($("challengePoints").value)){msg("challengeMsg","Escribe el desafío y un puntaje entero entre 1 y 1000.");return}
  const row={description,points:Number($("challengePoints").value),active:$("challengeActive").checked};
  try{
    const query=$("challengeId").value?db.from("challenges").update(row).eq("id",$("challengeId").value):db.from("challenges").insert(row);
    const {error}=await query;if(error){msg("challengeMsg","No se pudo guardar el desafío. Intenta nuevamente.");return}
    clearChallenge();msg("challengeMsg","Desafío guardado.");await loadAdmin();
  }catch{msg("challengeMsg",connectionMessage)}
});
function clearChallenge(){["challengeId","challengeText"].forEach(id=>$(id).value="");$("challengePoints").value=15;$("challengeActive").checked=true}
$("clearChallenge").onclick=clearChallenge;
function editChallenge(c){$("challengeId").value=c.id;$("challengeText").value=c.description;$("challengePoints").value=c.points;$("challengeActive").checked=c.active;$("challengeText").focus()}
async function toggleActive(table,id,active){
  try{const {error}=await db.from(table).update({active}).eq("id",id);if(error)throw error;await loadAdmin()}
  catch{msg("adminStatus","No se pudo cambiar la disponibilidad. Intenta nuevamente.")}
}
async function loadAdmin(){
  const id=user?.id;if(!id)return;
  const [questions,challenges]=await Promise.all([db.from("questions").select("*").order("created_at",{ascending:false}),db.from("challenges").select("*").order("created_at",{ascending:false})]);
  if(user?.id!==id || $("admin").hidden)return;
  if(questions.error || challenges.error){msg("adminStatus","No se pudo cargar el contenido. Pulsa Actualizar panel para reintentar.");return}
  msg("adminStatus","");questionCache=questions.data||[];challengeCache=challenges.data||[];
  $("questionList").innerHTML=questionCache.map(q=>`<div class="question"><strong>${escapeHtml(q.question)}</strong><small>${q.game==="tf"?"Verdadero/Falso":"Trivia nivel "+q.level} · ${q.points} puntos · ${q.active?"Activa":"Inactiva"}</small><button class="secondary" data-edit="${q.id}">Editar</button><button class="secondary" data-toggle="${q.id}">${q.active?"Desactivar":"Activar"}</button></div>`).join("")||'<p class="muted">Aún no hay preguntas. Crea las de cada nivel y las de Verdadero/Falso.</p>';
  $("questionList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editQuestion(questionCache.find(q=>q.id===b.dataset.edit)));
  $("questionList").querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>busy(b,()=>toggleActive("questions",b.dataset.toggle,!questionCache.find(q=>q.id===b.dataset.toggle).active)));
  $("challengeList").innerHTML=challengeCache.map(c=>`<div class="challenge"><strong>${escapeHtml(c.description)}</strong><small>${c.points} puntos · ${c.active?"Activo":"Inactivo"}</small><button class="secondary" data-edit="${c.id}">Editar</button><button class="secondary" data-toggle="${c.id}">${c.active?"Desactivar":"Activar"}</button></div>`).join("")||'<p class="muted">Aún no hay desafíos.</p>';
  $("challengeList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editChallenge(challengeCache.find(c=>c.id===b.dataset.edit)));
  $("challengeList").querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>busy(b,()=>toggleActive("challenges",b.dataset.toggle,!challengeCache.find(c=>c.id===b.dataset.toggle).active)));
  const trivia=[1,2,3].map(level=>`${["","FO","CT","Gerencia"][level]}: ${questionCache.filter(q=>q.game==="trivia" && q.level===level && q.active).length}`);
  msg("contentSummary",[...trivia,`Verdadero/Falso: ${questionCache.filter(q=>q.game==="tf" && q.active).length}`,`Objetos: ${challengeCache.filter(c=>c.active).length}`].join(" · "));
  await Promise.all([loadPending(),loadAdminRanking()]);
}
$("refreshAdmin").onclick=()=>busy($("refreshAdmin"),async()=>{try{await loadAdmin()}catch{msg("adminStatus",connectionMessage)}});
async function loadPending(){
  const id=user?.id;
  const {data,error}=await db.from("admin_submissions").select("*").eq("status","pending").order("created_at");
  if(user?.id!==id || $("admin").hidden)return;
  if(error){msg("pending","No se pudieron cargar las evidencias. Actualiza el panel.");return}
  const rows=await Promise.all((data||[]).map(async s=>{const signed=await db.storage.from("evidence").createSignedUrl(s.photo_path,300);return {...s,photo_url:signed.data?.signedUrl||""}}));
  if(user?.id!==id || $("admin").hidden)return;
  const el=$("pending");el.innerHTML=rows.map(s=>`<div class="submission"><b>${escapeHtml(s.nickname)} (${escapeHtml(s.role)})</b><p>${escapeHtml(s.description)}</p>${s.photo_url?`<img class="photo" src="${escapeHtml(s.photo_url)}" alt="Evidencia enviada">`:'<p class="msg">No se pudo abrir la imagen. Actualiza el panel para reintentar.</p>'}<button data-approve="${s.id}" ${s.photo_url?"":"disabled"}>Aprobar (+${s.points})</button><button class="secondary" data-reject="${s.id}">Rechazar</button><span class="msg" id="review-${s.id}" role="status"></span></div>`).join("")||'<p class="muted">No hay evidencias pendientes.</p>';
  el.querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>busy(b,()=>review(b.dataset.approve,true)));
  el.querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>busy(b,()=>review(b.dataset.reject,false)));
}
async function review(id,approved){
  try{const {error}=await db.rpc("review_submission",{p_submission_id:id,p_approved:approved});if(error)throw error;await Promise.all([loadPending(),loadAdminRanking()])}
  catch{const feedback=$("review-"+id);if(feedback)feedback.textContent="No se pudo revisar. Actualiza el panel e intenta nuevamente."}
}
async function loadAdminRanking(){
  const id=user?.id;const {data,error}=await db.from("public_ranking").select("*").order("points",{ascending:false}).order("nickname").limit(1000);
  if(user?.id!==id || $("admin").hidden)return;
  if(error){msg("adminRanking","No se pudo cargar el ranking. Actualiza el panel.");return}
  const rows=sortRanking(data||[]);
  $("adminRanking").innerHTML=rows.map(p=>`<div class="rankrow"><span>${rows.findIndex(other=>other.points===p.points)+1}. ${escapeHtml(p.nickname)} <span class="tag">${escapeHtml(p.role)}</span></span><b>${p.points}</b></div>`).join("")||'<p class="muted">Sin participantes todavía.</p>';
}
if(configured)session();
