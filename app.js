/* DAW DANY TOOL — v1.1 (desde cero, sin dependencias) */
(() => {
  const $ = sel => document.querySelector(sel);
  const log = (...args) => { const el = $('#console'); const d = document.createElement('div'); d.textContent = args.map(a => typeof a==='object'? JSON.stringify(a): String(a)).join(' '); el.prepend(d); };
  const fmtTime = s => (Math.max(0, s)||0).toFixed(1) + 's';
  const dbToGain = db => Math.pow(10, (db||0)/20);

  function tickClock(){
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset()*60000);
    const rd = new Date(utc - 4*3600000);
    const hh = String(rd.getHours()).padStart(2,'0');
    const mm = String(rd.getMinutes()).padStart(2,'0');
    const ss = String(rd.getSeconds()).padStart(2,'0');
    $('#clock').textContent = `${hh}:${mm}:${ss}`;
    requestAnimationFrame(tickClock);
  }
  tickClock();

  const S = {
    ctx: null, masterGain: null, analyser: null,
    playing:false, startTime:0, pauseOffset:0,
    loop:{enabled:false,start:0,end:8}, bpm:90,
    metro:{enabled:false,gain:null,tickBuf:null,nextTime:0},
    fx:null,
    tracks:[], markers:[],
    media:{stream:null,source:null,monitor:false,recorder:null,chunks:[],lastTake:null,audition:null}
  };

  function savePrefs(){ try{ localStorage.setItem('prefs', JSON.stringify({ theme: document.documentElement.classList.contains('light')?'light':'dark', bpm:S.bpm, loop:S.loop, metro:S.metro.enabled, master:+($('#masterGain')?.value||'0.85') })); }catch(e){} }
  function loadPrefs(){ try{ const p = JSON.parse(localStorage.getItem('prefs')||'{}'); if(p && typeof p==='object'){ if(typeof p.bpm==='number'){ S.bpm=p.bpm; const b=$('#bpm'); if(b) b.value=S.bpm; } if(p.loop && typeof p.loop.start==='number'){ S.loop.enabled=!!p.loop.enabled; S.loop.start=+p.loop.start||0; S.loop.end=+p.loop.end||8; const ls=$('#loopStart'), le=$('#loopEnd'), lt=$('#loopToggle'); if(ls) ls.value=S.loop.start; if(le) le.value=S.loop.end; if(lt) lt.textContent=S.loop.enabled? '🔁 ON':'🔁 OFF'; } if(typeof p.metro==='boolean'){ S.metro.enabled=p.metro; const m=$('#metroToggle'); if(m) m.classList.toggle('ok', S.metro.enabled); } if(typeof p.master==='number'){ const mg=$('#masterGain'); if(mg){ mg.value=String(p.master); } } } }catch(e){} }

  async function ensureAudio(){
    if (S.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { alert('WebAudio no disponible en este navegador.'); return; }
    const ctx = new AC({ latencyHint:'interactive' });
    const master = ctx.createGain(); master.gain.value = parseFloat(($('#masterGain')?.value)||'0.85');
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    master.connect(analyser); analyser.connect(ctx.destination);
    const metroGain = ctx.createGain(); metroGain.gain.value = 0; metroGain.connect(master);

    S.ctx = ctx; S.masterGain = master; S.analyser = analyser; S.metro.gain = metroGain;
    setupFX(ctx);
    S.metro.tickBuf = await createTickBuffer(ctx);
    drawAnalyzer();
    log('Audio inicializado.');
  }

  async function createTickBuffer(ctx){
    const rate = ctx.sampleRate; const len = Math.floor(0.03*rate);
    const buf = ctx.createBuffer(1, len, rate); const data = buf.getChannelData(0);
    for (let i=0;i<len;i++){ const t=i/len; data[i]=Math.sin(2*Math.PI*1000*(i/rate))*Math.exp(-20*t); }
    return buf;
  }

  function setupFX(ctx){
    const reverbIn = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = createIR(ctx, 2.4);
    const revWet = ctx.createGain(); revWet.gain.value = 0.25;
    reverbIn.connect(convolver); convolver.connect(revWet); revWet.connect(S.masterGain);

    const delIn = ctx.createGain();
    const delay = ctx.createDelay(5.0); delay.delayTime.value = 0.28;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const delWet = ctx.createGain(); delWet.gain.value = 0.25;
    delIn.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(delWet); delWet.connect(S.masterGain);

    S.fx = { reverb:{ input:reverbIn, convolver, wet:revWet, decay:2.4, level:0.25 }, delay:{ input:delIn, delay, feedback:fb, wet:delWet, time:0.28, fb:0.3, level:0.25 } };
  }
  function createIR(ctx, seconds){
    const len = Math.max(1, Math.floor(ctx.sampleRate * Math.max(0.1, seconds||1.5)));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for(let ch=0; ch<2; ch++){
      const data = buf.getChannelData(ch);
      for(let i=0;i<len;i++){ const t = i/len; data[i] = (Math.random()*2-1) * Math.pow(1-t, 3.5); }
    }
    return buf;
  }

  function getPos(){ if (!S.ctx) return 0; return S.playing ? (S.ctx.currentTime - S.startTime) : S.pauseOffset; }
  function setPos(seconds){ S.pauseOffset = Math.max(0, seconds); if (S.playing){ stopTracks(); S.startTime = S.ctx.currentTime - S.pauseOffset; for (const tr of S.tracks){ tr.start(); } } updatePosUI(); }
  function updatePosUI(){ const p = getPos(); $('#pos').textContent = fmtTime(p); $('#takePos').textContent = fmtTime(p); const tl=$('#timeline'), ph=$('#playhead'); const dur=Math.max(8,getProjectDuration()); const x=Math.min(1,p/dur)*tl.clientWidth; ph.style.left = x+'px'; if (S.loop.enabled && p >= S.loop.end){ setPos(S.loop.start); } }
  function rafPos(){ updatePosUI(); if (S.playing) requestAnimationFrame(rafPos); }

  function getProjectDuration(){ let d=0; for (const tr of S.tracks){ d=Math.max(d, tr.getDuration()); } return d; }

  class AudioTrack{
    constructor(name, buf){ this.kind='audio'; this.name=name; this.buf=buf; this.gain=0.9; this.pan=0; this.mute=false; this.solo=false; this.sendA=0; this.sendB=0; this.eq={ enabled:true, hpf:{freq:60,q:0.707}, peak:{freq:1000,gain:0,q:1}, lpf:{freq:12000,q:0.707} }; this.comp={ enabled:false, threshold:-24, ratio:4, attack:0.003, release:0.25, makeup:0 }; this.eqNodes=null; this.compNodes=null; this.node=null; this.gainNode=null; this.panNode=null; this.busGain=null; this.sendAGain=null; this.sendBGain=null; this.meter=null; this.canvas=null; }
    attachCanvas(canvas){ this.canvas=canvas; this.drawWaveform(); }
    drawWaveform(){ if(!this.canvas||!this.buf) return; const c=this.canvas.getContext('2d'); const W=this.canvas.width=this.canvas.clientWidth*devicePixelRatio; const H=this.canvas.height=this.canvas.clientHeight*devicePixelRatio; c.clearRect(0,0,W,H); c.fillStyle='#0b0d12'; c.fillRect(0,0,W,H); c.strokeStyle='#22d3ee'; c.lineWidth=1; const data=this.buf.getChannelData(0); const step=Math.max(1, Math.floor(data.length/W)); c.beginPath(); for(let x=0;x<W;x++){ let min=1,max=-1; const i0=x*step, i1=Math.min(data.length,i0+step); for(let i=i0;i<i1;i++){ const v=data[i]; if(v<min)min=v; if(v>max)max=v; } const y1=(1-(max+1)/2)*H, y2=(1-(min+1)/2)*H; c.moveTo(x,y1); c.lineTo(x,y2); } c.stroke(); }
    _build(){ const ctx=S.ctx; const src=ctx.createBufferSource(); src.buffer=this.buf; const g=ctx.createGain(); g.gain.value=this.gain; let out=g; if (ctx.createStereoPanner){ const p=ctx.createStereoPanner(); p.pan.value=this.pan; g.connect(p); out=p; } src.connect(g);
      let sig = out;
      if (this.eq && this.eq.enabled){ const hpf=ctx.createBiquadFilter(); hpf.type='highpass'; hpf.frequency.value=this.eq.hpf.freq; hpf.Q.value=this.eq.hpf.q; const peak=ctx.createBiquadFilter(); peak.type='peaking'; peak.frequency.value=this.eq.peak.freq; peak.gain.value=this.eq.peak.gain; peak.Q.value=this.eq.peak.q; const lpf=ctx.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=this.eq.lpf.freq; lpf.Q.value=this.eq.lpf.q; sig.connect(hpf); hpf.connect(peak); peak.connect(lpf); sig=lpf; this.eqNodes={hpf,peak,lpf}; } else { this.eqNodes=null; }
      if (this.comp && this.comp.enabled){ const comp=ctx.createDynamicsCompressor(); comp.threshold.value=this.comp.threshold; comp.ratio.value=this.comp.ratio; comp.attack.value=this.comp.attack; comp.release.value=this.comp.release; const mu=ctx.createGain(); mu.gain.value=dbToGain(this.comp.makeup); sig.connect(comp); comp.connect(mu); sig=mu; this.compNodes={comp, makeup:mu}; } else { this.compNodes=null; }
      const bus=ctx.createGain(); bus.gain.value=1; sig.connect(bus); bus.connect(S.masterGain); const meter=ctx.createAnalyser(); meter.fftSize=512; bus.connect(meter); const sA=ctx.createGain(); sA.gain.value=this.sendA||0; out.connect(sA); if(S.fx) sA.connect(S.fx.reverb.input); const sB=ctx.createGain(); sB.gain.value=this.sendB||0; out.connect(sB); if(S.fx) sB.connect(S.fx.delay.input);
      this.node=src; this.gainNode=g; this.panNode=(out!==g? out:null); this.busGain=bus; this.meter=meter; this.sendAGain=sA; this.sendBGain=sB; applyMuteSolo(); }
    start(){ this._build(); const when=S.ctx.currentTime; const off=getPos(); const posInBuf=Math.min(this.buf.duration, off); this.node.start(when, posInBuf); }
    stop(){ try{ this.node && this.node.stop(); }catch{} this.node=null; this.gainNode=null; this.panNode=null; this.busGain=null; this.sendAGain=null; this.sendBGain=null; this.eqNodes=null; this.compNodes=null; this.meter=null; }
    getDuration(){ return this.buf? this.buf.duration : 0; }
  }
  class InstrumentTrack{
    constructor(name='Instrumento'){ this.kind='instrument'; this.name=name; this.notes=[]; this.gain=0.6; this.pan=0; this.mute=false; this.solo=false; this.sendA=0; this.sendB=0; this.eq={ enabled:true, hpf:{freq:60,q:0.707}, peak:{freq:1000,gain:0,q:1}, lpf:{freq:12000,q:0.707} }; this.comp={ enabled:false, threshold:-24, ratio:4, attack:0.003, release:0.25, makeup:0 }; this.gainNode=null; this.busGain=null; this.sendAGain=null; this.sendBGain=null; this.eqNodes=null; this.compNodes=null; this.meter=null; this.canvas=null; }
    attachCanvas(c){ this.canvas=c; this.drawWaveform(); }
    drawWaveform(){ if(!this.canvas) return; const c=this.canvas.getContext('2d'); const W=this.canvas.width=this.canvas.clientWidth*devicePixelRatio; const H=this.canvas.height=this.canvas.clientHeight*devicePixelRatio; c.clearRect(0,0,W,H); c.fillStyle='#0b0d12'; c.fillRect(0,0,W,H); c.fillStyle='#14b8a6'; for(const n of this.notes){ const x=(n.t/Math.max(8,getProjectDuration()))*W; c.fillRect(x, H-20, 8*devicePixelRatio, 18); } }
    _graph(){ const ctx=S.ctx; const g=ctx.createGain(); g.gain.value=this.gain; let out=g; if (ctx.createStereoPanner){ const p=ctx.createStereoPanner(); p.pan.value=this.pan; g.connect(p); out=p; }
      let sig = out; if (this.eq && this.eq.enabled){ const hpf=ctx.createBiquadFilter(); hpf.type='highpass'; hpf.frequency.value=this.eq.hpf.freq; hpf.Q.value=this.eq.hpf.q; const peak=ctx.createBiquadFilter(); peak.type='peaking'; peak.frequency.value=this.eq.peak.freq; peak.gain.value=this.eq.peak.gain; peak.Q.value=this.eq.peak.q; const lpf=ctx.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=this.eq.lpf.freq; lpf.Q.value=this.eq.lpf.q; sig.connect(hpf); hpf.connect(peak); peak.connect(lpf); sig=lpf; this.eqNodes={hpf,peak,lpf}; } else { this.eqNodes=null; }
      if (this.comp && this.comp.enabled){ const comp=ctx.createDynamicsCompressor(); comp.threshold.value=this.comp.threshold; comp.ratio.value=this.comp.ratio; comp.attack.value=this.comp.attack; comp.release.value=this.comp.release; const mu=ctx.createGain(); mu.gain.value=dbToGain(this.comp.makeup); sig.connect(comp); comp.connect(mu); sig=mu; this.compNodes={comp, makeup:mu}; } else { this.compNodes=null; }
      const bus=ctx.createGain(); bus.gain.value=1; sig.connect(bus); bus.connect(S.masterGain); const meter=ctx.createAnalyser(); meter.fftSize=512; bus.connect(meter); const sA=ctx.createGain(); sA.gain.value=this.sendA||0; out.connect(sA); if(S.fx) sA.connect(S.fx.reverb.input); const sB=ctx.createGain(); sB.gain.value=this.sendB||0; out.connect(sB); if(S.fx) sB.connect(S.fx.delay.input); this.gainNode=g; this.busGain=bus; this.meter=meter; this.sendAGain=sA; this.sendBGain=sB; }
    start(){ this._graph(); const ctx=S.ctx; const offset=getPos(); const base=ctx.currentTime - offset; for(const n of this.notes){ const osc=ctx.createOscillator(); osc.type='sine'; osc.frequency.value = 220*Math.pow(2,(n.m-1)/12); const env=ctx.createGain(); env.gain.value=0; osc.connect(env); env.connect(this.gainNode); const t=base+n.t; env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.005); env.gain.exponentialRampToValueAtTime(0.0001, t+Math.max(0.12,n.d||0.25)); osc.start(t); osc.stop(t+Math.max(0.12,n.d||0.25)+0.05); } applyMuteSolo(); }
    stop(){}
    getDuration(){ let d=0; for(const n of this.notes){ d=Math.max(d, n.t+(n.d||0.25)); } return d; }
  }

  async function startTransport(){ await ensureAudio(); S.playing=true; S.startTime = S.ctx.currentTime - S.pauseOffset; for(const tr of S.tracks){ tr.start(); } if (S.metro.enabled){ S.metro.nextTime = S.ctx.currentTime + 0.05; scheduleMetronome(); S.metro.gain.gain.setTargetAtTime(0.7, S.ctx.currentTime, 0.01); } rafPos(); startMeters(); }
  function pauseTransport(){ if (!S.ctx) return; S.playing=false; S.pauseOffset=getPos(); stopTracks(); S.metro.gain.gain.setTargetAtTime(0, S.ctx.currentTime, 0.01); }
  function stopTransport(){ if (!S.ctx) return; S.playing=false; S.pauseOffset=0; stopTracks(); setPos(0); S.metro.gain.gain.setTargetAtTime(0, S.ctx.currentTime, 0.01); }
  function stopTracks(){ for(const tr of S.tracks){ tr.stop(); } }
  function restartIfPlaying(){ if(S.ctx && S.playing){ setPos(getPos()); } }

  function scheduleMetronome(){ const ctx=S.ctx; if(!ctx) return; const bps=S.bpm/60; const interval=1/bps; const look=0.1; const ahead=0.2; const now=ctx.currentTime; if (S.metro.nextTime < now) S.metro.nextTime = now + 0.05; while (S.metro.nextTime < now + ahead){ const t=S.metro.nextTime; const src=ctx.createBufferSource(); src.buffer=S.metro.tickBuf; src.connect(S.metro.gain); src.start(t); S.metro.nextTime += interval; } if (S.playing && S.metro.enabled){ setTimeout(scheduleMetronome, look*1000); } }

  function drawAnalyzer(){ const cvs=$('#analyzer'); const c=cvs.getContext('2d'); function loop(){ if(!S.analyser){ requestAnimationFrame(loop); return; } const W=cvs.width=cvs.clientWidth*devicePixelRatio; const H=cvs.height=cvs.clientHeight*devicePixelRatio; const data=new Uint8Array(S.analyser.frequencyBinCount); S.analyser.getByteFrequencyData(data); c.clearRect(0,0,W,H); const barW=Math.max(1, Math.floor(W/data.length)); for(let i=0;i<data.length;i++){ const v=data[i]/255; const h=v*H; const x=i*barW; const grad=c.createLinearGradient(0,0,0,H); grad.addColorStop(0,'#22d3ee'); grad.addColorStop(1,'#14b8a6'); c.fillStyle=grad; c.fillRect(x, H-h, barW-1, h); }
    const td=new Float32Array(S.analyser.fftSize); S.analyser.getFloatTimeDomainData(td); let peak=0,sum=0; for(const s of td){ const a=Math.abs(s); if(a>peak) peak=a; sum+=s*s; } const rms=Math.sqrt(sum/td.length); const peakDb=20*Math.log10(peak||1e-6); const rmsDb=20*Math.log10(rms||1e-6); const lufsEl=$('#lufs'); const peakEl=$('#peak'); if(lufsEl) lufsEl.textContent=(rmsDb).toFixed(1); if(peakEl) peakEl.textContent=peakDb.toFixed(1)+' dBFS'; requestAnimationFrame(loop); }
    loop(); }

  function startMeters(){ function tick(){ if(!S.playing) return; for(let i=0;i<S.tracks.length;i++){ const tr=S.tracks[i]; const el=document.querySelector(`#meter-${i}`); if(tr && tr.meter && el){ const arr=new Uint8Array(tr.meter.fftSize); tr.meter.getByteTimeDomainData(arr); let peak=0; for(const v of arr){ const a=Math.abs(v-128)/128; if(a>peak) peak=a; } const lvl=Math.min(1, peak*1.8); el.style.height = Math.floor(lvl*100)+'%'; el.style.background = lvl>0.85? 'linear-gradient(180deg,#ef4444,#f59e0b)':'linear-gradient(180deg, rgba(34,211,238,.7), rgba(20,184,166,.6))'; }
      const gr=document.querySelector(`#gr-${i}`); if(gr && tr.compNodes?.comp){ const red = tr.compNodes.comp.reduction||0; gr.textContent = (red||0).toFixed(1)+' dB'; gr.style.color = red < -0.1 ? '#22d3ee' : '#9aa3b2'; } }
      requestAnimationFrame(tick); } requestAnimationFrame(tick); }

  function addMarker(){ const t=getPos(); const list=$('#markers'); const b=document.createElement('button'); b.className='marker'; b.textContent='📍 '+fmtTime(t); b.addEventListener('click',()=>setPos(t)); list.appendChild(b); S.markers.push(t); }

  async function initMic(){ try{ const stream=await navigator.mediaDevices.getUserMedia({audio:true}); const src=S.ctx.createMediaStreamSource(stream); S.media.stream=stream; S.media.source=src; log('Micrófono listo.'); }catch(err){ log('Error micrófono:', err.message||err); alert('Permite el micrófono para grabar.'); } }
  async function toggleMonitor(){ await ensureAudio(); if(!S.media.stream) await initMic(); if(!S.media.stream) return; S.media.monitor=!S.media.monitor; if(S.media.monitor){ S.media.source.connect(S.masterGain); } else { try{ S.media.source.disconnect(S.masterGain);}catch{} } $('#btnMon').classList.toggle('ok', S.media.monitor); }
  async function recordToggle(){ await ensureAudio(); if(!S.media.stream) await initMic(); if(!S.media.stream) return; if(!S.media.recorder){ S.media.recorder = new MediaRecorder(S.media.stream); S.media.recorder.ondataavailable = e=> S.media.chunks.push(e.data); S.media.recorder.onstop = onTakeReady; }
    if (S.media.recorder.state === 'recording'){ S.media.recorder.stop(); $('#btnRec').textContent='🎙️ Grabar'; } else { S.media.chunks=[]; S.media.recorder.start(); $('#btnRec').textContent='⏺️ Grabando…'; } }
  async function onTakeReady(){ const blob = new Blob(S.media.chunks, {type:'audio/webm'}); const arr = await blob.arrayBuffer(); const buf = await S.ctx.decodeAudioData(arr); S.media.lastTake = buf; const tr = new AudioTrack('Toma de mic', buf); S.tracks.push(tr); addTrackUI(tr); log('Toma agregada como pista.'); }

  async function addAudioFile(file){ await ensureAudio(); const arr=await file.arrayBuffer(); const buf=await S.ctx.decodeAudioData(arr); const tr=new AudioTrack(file.name.replace(/\.[^/.]+$/,''), buf); S.tracks.push(tr); addTrackUI(tr); log('Pista añadida:', tr.name); }
  function addInstrumentTrack(){ const tr = new InstrumentTrack('Instrumento'); const bps=S.bpm/60; for(let i=0;i<8;i++){ tr.notes.push({ t=i*(1/bps), m:(i%2?4:7), d:0.18 }); } S.tracks.push(tr); addTrackUI(tr); log('Pista instrumento añadida.'); }

  function addTrackUI(track){ const list=$('#trackList'); const row=document.createElement('div'); row.className='track'; row.innerHTML = `<div>🎚️</div><div><div class="name">${track.name}</div><div class="wave"><canvas></canvas></div></div><div style="display:flex;flex-direction:column;gap:6px;"><label>Vol <input class="vol" type="range" min="0" max="1" step="0.01" value="${track.gain}"></label><label>Pan <input class="pan" type="range" min="-1" max="1" step="0.01" value="${track.pan||0}"></label></div>`; list.appendChild(row); const canvas=row.querySelector('canvas'); track.attachCanvas(canvas); const vol=row.querySelector('.vol'), pan=row.querySelector('.pan'); vol.addEventListener('input', e=>{ track.gain=+e.target.value; if(track.gainNode) track.gainNode.gain.value=track.gain; }); pan.addEventListener('input', e=>{ track.pan=+e.target.value; if(track.panNode) track.panNode.pan.value=track.pan; }); }

  async function exportMix(){ await ensureAudio(); if (!S.ctx) return; const sr=S.ctx.sampleRate; const dur=Math.max(1, getProjectDuration()); const off=new OfflineAudioContext(2, Math.ceil(dur*sr), sr); const master=off.createGain(); master.gain.value = $('#masterGain').value; master.connect(off.destination);
    for(const tr of S.tracks){ if(tr.kind==='audio'){ const src=off.createBufferSource(); src.buffer=tr.buf; const g=off.createGain(); g.gain.value=tr.gain; let out=g; if (off.createStereoPanner){ const p=off.createStereoPanner(); p.pan.value=tr.pan; g.connect(p); out=p; } src.connect(g); out.connect(master); src.start(0); } else if (tr.kind==='instrument'){ const g=off.createGain(); g.gain.value=tr.gain; let out=g; if (off.createStereoPanner){ const p=off.createStereoPanner(); p.pan.value=tr.pan; g.connect(p); out=p; } out.connect(master); for(const n of tr.notes){ const osc=off.createOscillator(); osc.type='sine'; osc.frequency.value=220*Math.pow(2,(n.m-1)/12); const env=off.createGain(); env.gain.value=0; osc.connect(env); env.connect(g); const t=n.t; env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.005); env.gain.exponentialRampToValueAtTime(0.0001, t+Math.max(0.12,n.d||0.25)); osc.start(t); osc.stop(t+Math.max(0.12,n.d||0.25)+0.05); } } }
    if (S.metro.enabled){ const tick=S.metro.tickBuf; const bps=S.bpm/60; let t=0; while(t<dur){ const src=off.createBufferSource(); src.buffer=tick; src.connect(master); src.start(t); t += 1/bps; } }
    const buf = await off.startRendering(); const wav = audioBufferToWav(buf); const url=URL.createObjectURL(new Blob([wav],{type:'audio/wav'})); const a=document.createElement('a'); a.href=url; a.download='daw_dany_mix.wav'; a.click(); }

  function audioBufferToWav(buffer){ const numCh=buffer.numberOfChannels; const length=buffer.length * numCh * 2 + 44; const buf=new ArrayBuffer(length); const view=new DataView(buf); write(view,0,'RIFF'); view.setUint32(4,36 + buffer.length * numCh * 2, true); write(view,8,'WAVE'); write(view,12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,numCh,true); view.setUint32(24,buffer.sampleRate,true); view.setUint32(28,buffer.sampleRate*2*numCh,true); view.setUint16(32,numCh*2,true); view.setUint16(34,16,true); write(view,36,'data'); view.setUint32(40, buffer.length * numCh * 2, true); let off=44; for(let i=0;i<buffer.length;i++){ for(let ch=0; ch<numCh; ch++){ let s=buffer.getChannelData(ch)[i]; s = Math.max(-1, Math.min(1, s)); view.setInt16(off, s<0 ? s*0x8000 : s*0x7FFF, true); off+=2; } } return buf; }
  function write(v, off, str){ for(let i=0;i<str.length;i++){ v.setUint8(off+i, str.charCodeAt(i)); } }

  function applyMuteSolo(){ const hasSolo = S.tracks.some(t=>t.solo); for(const tr of S.tracks){ if(tr.busGain){ const active = !tr.mute && (!hasSolo || tr.solo); tr.busGain.gain.setTargetAtTime(active?1:0, S.ctx.currentTime, 0.01); } if(tr.sendAGain) tr.sendAGain.gain.setTargetAtTime(tr.sendA||0, S.ctx.currentTime, 0.01); if(tr.sendBGain) tr.sendBGain.gain.setTargetAtTime(tr.sendB||0, S.ctx.currentTime, 0.01); } }

  function renderMixer(){ const mixView=$('#mixerView'); const strips=$('#mixerStrips'); const bus=$('#busControls'); if(!mixView||!strips||!bus) return; bus.innerHTML = '';
    if(S.fx){ const r = document.createElement('div'); r.className='row'; r.innerHTML = `<strong>Reverb</strong> <label>Nivel retorno <input id="revLevel" type="range" min="0" max="1" step="0.01" value="${S.fx.reverb.level}"></label> <label>Decaimiento (s) <input id="revDecay" type="range" min="0.2" max="6" step="0.1" value="${S.fx.reverb.decay}"></label>`; bus.appendChild(r); const d=document.createElement('div'); d.className='row'; d.innerHTML = `<strong>Delay</strong> <label>Nivel retorno <input id="delLevel" type="range" min="0" max="1" step="0.01" value="${S.fx.delay.level}"></label> <label>Tiempo (ms) <input id="delTime" type="range" min="40" max="800" step="1" value="${Math.round(S.fx.delay.time*1000)}"></label> <label>Feedback <input id="delFb" type="range" min="0" max="0.95" step="0.01" value="${S.fx.delay.fb}"></label>`; bus.appendChild(d);
      $('#revLevel').addEventListener('input', e=>{ S.fx.reverb.level=+e.target.value; S.fx.reverb.wet.gain.value=S.fx.reverb.level; });
      $('#revDecay').addEventListener('input', e=>{ S.fx.reverb.decay=+e.target.value; S.fx.reverb.convolver.buffer=createIR(S.ctx, S.fx.reverb.decay); });
      $('#delLevel').addEventListener('input', e=>{ S.fx.delay.level=+e.target.value; S.fx.delay.wet.gain.value=S.fx.delay.level; });
      $('#delTime').addEventListener('input', e=>{ S.fx.delay.time=(+e.target.value)/1000; S.fx.delay.delay.delayTime.value=S.fx.delay.time; });
      $('#delFb').addEventListener('input', e=>{ S.fx.delay.fb=+e.target.value; S.fx.delay.feedback.gain.value=S.fx.delay.fb; });
    }
    strips.innerHTML='';
    S.tracks.forEach((tr,i)=>{ const el=document.createElement('div'); el.className='strip'; el.innerHTML = `<div class="head"><span class="name" contenteditable="true" data-i="${i}">${tr.name}</span></div><div class="meter"><div class="lvl" id="meter-${i}"></div></div><div class="group"><button class="btn ${tr.mute?'danger':''}" data-act="mute" data-i="${i}">${tr.mute?'Silencio ON':'Silenciar'}</button><button class="btn ${tr.solo?'primary':''}" data-act="solo" data-i="${i}">${tr.solo?'Solo ON':'Solo'}</button></div><label>Volumen <input class="mix-fader" data-i="${i}" type="range" min="0" max="1" step="0.01" value="${tr.gain}"></label><label>Panorama <input class="mix-pan" data-i="${i}" type="range" min="-1" max="1" step="0.01" value="${tr.pan||0}"></label><label>Envío A (Reverb) <input class="mix-sendA" data-i="${i}" type="range" min="0" max="1" step="0.01" value="${tr.sendA||0}"></label><label>Envío B (Delay) <input class="mix-sendB" data-i="${i}" type="range" min="0" max="1" step="0.01" value="${tr.sendB||0}"></label><div class="group"><strong>EQ</strong> <button class="btn ${tr.eq?.enabled?'':'warn'}" data-act="eq" data-i="${i}">${tr.eq?.enabled?'Activado':'Bypass'}</button></div><div class="group small"><span>HPF</span><label>Freq <input class="eq-hpf-f" data-i="${i}" type="range" min="20" max="2000" step="1" value="${tr.eq?.hpf?.freq||60}"></label><label>Q <input class="eq-hpf-q" data-i="${i}" type="range" min="0.1" max="3" step="0.01" value="${tr.eq?.hpf?.q||0.707}"></label></div><div class="group small"><span>Banda</span><label>Freq <input class="eq-peak-f" data-i="${i}" type="range" min="100" max="8000" step="1" value="${tr.eq?.peak?.freq||1000}"></label><label>Ganancia (dB) <input class="eq-peak-g" data-i="${i}" type="range" min="-12" max="12" step="0.1" value="${tr.eq?.peak?.gain||0}"></label><label>Q <input class="eq-peak-q" data-i="${i}" type="range" min="0.1" max="10" step="0.01" value="${tr.eq?.peak?.q||1}"></label></div><div class="group small"><span>LPF</span><label>Freq <input class="eq-lpf-f" data-i="${i}" type="range" min="1000" max="20000" step="1" value="${tr.eq?.lpf?.freq||12000}"></label><label>Q <input class="eq-lpf-q" data-i="${i}" type="range" min="0.1" max="3" step="0.01" value="${tr.eq?.lpf?.q||0.707}"></label></div><div class="group"><strong>Compresor</strong> <button class="btn ${tr.comp?.enabled?'':'warn'}" data-act="comp" data-i="${i}">${tr.comp?.enabled?'Activado':'Bypass'}</button> <span class="sub">Reducción:</span> <span id="gr-${i}" class="badge">0 dB</span></div><div class="group small"><label>Umbral (dB) <input class="comp-th" data-i="${i}" type="range" min="-60" max="0" step="1" value="${tr.comp?.threshold??-24}"></label><label>Relación <input class="comp-ra" data-i="${i}" type="range" min="1" max="20" step="0.1" value="${tr.comp?.ratio??4}"></label><label>Ataque (ms) <input class="comp-at" data-i="${i}" type="range" min="0" max="200" step="1" value="${Math.round((tr.comp?.attack??0.003)*1000)}"></label><label>Release (ms) <input class="comp-re" data-i="${i}" type="range" min="10" max="2000" step="10" value="${Math.round((tr.comp?.release??0.25)*1000)}"></label><label>Makeup (dB) <input class="comp-mu" data-i="${i}" type="range" min="-12" max="24" step="0.5" value="${tr.comp?.makeup??0}"></label></div>`; strips.appendChild(el); });

    strips.querySelectorAll('.mix-fader').forEach(inp=> inp.addEventListener('input', e=>{ const i=+e.target.dataset.i; const tr=S.tracks[i]; tr.gain=+e.target.value; if(tr.gainNode) tr.gainNode.gain.value=tr.gain; }));
    strips.querySelectorAll('.mix-pan').forEach(inp=> inp.addEventListener('input', e=>{ const i=+e.target.dataset.i; const tr=S.tracks[i]; tr.pan=+e.target.value; if(tr.panNode && tr.panNode.pan) tr.panNode.pan.value=tr.pan; }));
    strips.querySelectorAll('.mix-sendA').forEach(inp=> inp.addEventListener('input', e=>{ const i=+e.target.dataset.i; const tr=S.tracks[i]; tr.sendA=+e.target.value; if(tr.sendAGain) tr.sendAGain.gain.value=tr.sendA; }));
    strips.querySelectorAll('.mix-sendB').forEach(inp=> inp.addEventListener('input', e=>{ const i=+e.target.dataset.i; const tr=S.tracks[i]; tr.sendB=+e.target.value; if(tr.sendBGain) tr.sendBGain.gain.value=tr.sendB; }));

    strips.querySelectorAll('button[data-act="mute"]').forEach(btn=> btn.addEventListener('click', e=>{ const i=+e.target.dataset.i; const tr=S.tracks[i]; tr.mute=!tr.mute; renderMixer(); applyMuteSolo(); }));
    strips.querySelectorAll('button[data-act="solo"]').forEach(btn=> btn.addEventListener('click', e=>{ const i=+e.target.dataset.i; const tr=S.tracks[i]; tr.solo=!tr.solo; renderMixer(); applyMuteSolo(); }));

    strips.querySelectorAll('button[data-act="eq"]').forEach(btn=> btn.addEventListener('click', e=>{ const i=+e.target.dataset.i; const tr=S.tracks[i]; tr.eq.enabled = !tr.eq.enabled; renderMixer(); restartIfPlaying(); }));

    strips.querySelectorAll('button[data-act="comp"]').forEach(btn=> btn.addEventListener('click', e=>{ const i=+e.target.dataset.i; const tr=S.tracks[i]; tr.comp.enabled = !tr.comp.enabled; renderMixer(); restartIfPlaying(); }));

    function updComp(i, key, v){ const tr=S.tracks[i]; tr.comp[key]=v; if(tr.compNodes?.comp){ if(key==='threshold') tr.compNodes.comp.threshold.value=v; else if(key==='ratio') tr.compNodes.comp.ratio.value=v; else if(key==='attack') tr.compNodes.comp.attack.value=v; else if(key==='release') tr.compNodes.comp.release.value=v; } if(tr.compNodes?.makeup && key==='makeup'){ tr.compNodes.makeup.gain.value=dbToGain(v); } }

    strips.querySelectorAll('.comp-th').forEach(inp=> inp.addEventListener('input', e=> updComp(+e.target.dataset.i, 'threshold', +e.target.value)));
    strips.querySelectorAll('.comp-ra').forEach(inp=> inp.addEventListener('input', e=> updComp(+e.target.dataset.i, 'ratio', +e.target.value)));
    strips.querySelectorAll('.comp-at').forEach(inp=> inp.addEventListener('input', e=> updComp(+e.target.dataset.i, 'attack', (+e.target.value)/1000)));
    strips.querySelectorAll('.comp-re').forEach(inp=> inp.addEventListener('input', e=> updComp(+e.target.dataset.i, 'release', (+e.target.value)/1000)));
    strips.querySelectorAll('.comp-mu').forEach(inp=> inp.addEventListener('input', e=> updComp(+e.target.dataset.i, 'makeup', +e.target.value)));

    function updEQ(i, path, v){ const tr=S.tracks[i]; const seg=path.split('.'); if(seg[0]==='hpf'){ tr.eq.hpf[seg[1]]=v; if(tr.eqNodes?.hpf){ if(seg[1]==='freq') tr.eqNodes.hpf.frequency.value=v; else if(seg[1]==='q') tr.eqNodes.hpf.Q.value=v; } }
      else if(seg[0]==='peak'){ tr.eq.peak[seg[1]]=v; if(tr.eqNodes?.peak){ if(seg[1]==='freq') tr.eqNodes.peak.frequency.value=v; else if(seg[1]==='q') tr.eqNodes.peak.Q.value=v; else if(seg[1]==='gain') tr.eqNodes.peak.gain.value=v; } }
      else if(seg[0]==='lpf'){ tr.eq.lpf[seg[1]]=v; if(tr.eqNodes?.lpf){ if(seg[1]==='freq') tr.eqNodes.lpf.frequency.value=v; else if(seg[1]==='q') tr.eqNodes.lpf.Q.value=v; } }
    }
    strips.querySelectorAll('.eq-hpf-f').forEach(inp=> inp.addEventListener('input', e=> updEQ(+e.target.dataset.i, 'hpf.freq', +e.target.value)));
    strips.querySelectorAll('.eq-hpf-q').forEach(inp=> inp.addEventListener('input', e=> updEQ(+e.target.dataset.i, 'hpf.q', +e.target.value)));
    strips.querySelectorAll('.eq-peak-f').forEach(inp=> inp.addEventListener('input', e=> updEQ(+e.target.dataset.i, 'peak.freq', +e.target.value)));
    strips.querySelectorAll('.eq-peak-g').forEach(inp=> inp.addEventListener('input', e=> updEQ(+e.target.dataset.i, 'peak.gain', +e.target.value)));
    strips.querySelectorAll('.eq-peak-q').forEach(inp=> inp.addEventListener('input', e=> updEQ(+e.target.dataset.i, 'peak.q', +e.target.value)));
    strips.querySelectorAll('.eq-lpf-f').forEach(inp=> inp.addEventListener('input', e=> updEQ(+e.target.dataset.i, 'lpf.freq', +e.target.value)));
    strips.querySelectorAll('.eq-lpf-q').forEach(inp=> inp.addEventListener('input', e=> updEQ(+e.target.dataset.i, 'lpf.q', +e.target.value)));

    strips.querySelectorAll('.name').forEach(n=> n.addEventListener('input', e=>{ const i=+e.target.dataset.i; S.tracks[i].name = e.target.textContent.trim()||S.tracks[i].name; }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadPrefs();
    $('#btnPlay').addEventListener('click', startTransport);
    $('#btnPause').addEventListener('click', pauseTransport);
    $('#btnStop').addEventListener('click', stopTransport);
    $('#seekM5').addEventListener('click', () => setPos(getPos()-5));
    $('#seekM1').addEventListener('click', () => setPos(getPos()-1));
    $('#seekP1').addEventListener('click', () => setPos(getPos()+1));
    $('#seekP5').addEventListener('click', () => setPos(getPos()+5));
    $('#loopToggle').addEventListener('click', e=>{ S.loop.enabled=!S.loop.enabled; e.target.textContent = S.loop.enabled? '🔁 ON':'🔁 OFF'; savePrefs(); });
    $('#loopStart').addEventListener('input', e=> { S.loop.start = +e.target.value; savePrefs(); });
    $('#loopEnd').addEventListener('input', e=> { S.loop.end = +e.target.value; savePrefs(); });
    $('#bpm').addEventListener('input', e=> { S.bpm = +e.target.value; savePrefs(); });
    $('#metroToggle').addEventListener('click', (e)=>{ S.metro.enabled=!S.metro.enabled; e.target.classList.toggle('ok', S.metro.enabled); if (S.playing) scheduleMetronome(); savePrefs(); });
    $('#addMarker').addEventListener('click', addMarker);

    $('#addAudio').addEventListener('change', e=>{ const f=e.target.files[0]; if(f) addAudioFile(f); e.target.value=''; renderMixer(); });
    $('#addInstrument').addEventListener('click', ()=>{ addInstrumentTrack(); renderMixer(); });

    $('#masterGain').addEventListener('input', e=>{ if (S.masterGain) S.masterGain.gain.value = +e.target.value; savePrefs(); });

    $('#exportMix').addEventListener('click', exportMix);
    $('#clearAll').addEventListener('click', ()=>{ stopTransport(); S.tracks.length=0; $('#trackList').innerHTML=''; $('#markers').innerHTML=''; S.markers=[]; renderMixer(); log('Proyecto limpio.'); });

    $('#saveJson').addEventListener('click', ()=>{ const data={ bpm:S.bpm, markers:S.markers, tracks:S.tracks.map(tr=>({ kind:tr.kind, name:tr.name, gain:tr.gain, pan:tr.pan, notes: tr.notes||[] })), mix:{ master: +($('#masterGain')?.value||'0.85'), tracks: S.tracks.map(tr=>({ name:tr.name, mute:!!tr.mute, solo:!!tr.solo, gain:tr.gain, pan:tr.pan, sendA:tr.sendA||0, sendB:tr.sendB||0, eq:{ enabled: tr.eq?.enabled!==false, hpf:{ freq: tr.eq?.hpf?.freq||60, q: tr.eq?.hpf?.q||0.707 }, peak:{ freq: tr.eq?.peak?.freq||1000, gain: tr.eq?.peak?.gain||0, q: tr.eq?.peak?.q||1 }, lpf:{ freq: tr.eq?.lpf?.freq||12000, q: tr.eq?.lpf?.q||0.707 } }, comp:{ enabled: !!tr.comp?.enabled, threshold: tr.comp?.threshold??-24, ratio: tr.comp?.ratio??4, attack: tr.comp?.attack??0.003, release: tr.comp?.release??0.25, makeup: tr.comp?.makeup??0 } })), buses:{ reverb:{ level:S.fx?.reverb?.level||0, decay:S.fx?.reverb?.decay||2.4 }, delay:{ level:S.fx?.delay?.level||0, time:S.fx?.delay?.time||0.28, fb:S.fx?.delay?.fb||0.3 } } } }; const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='proyecto_daw_dany.json'; a.click(); });

    $('#loadJson').addEventListener('change', async (e)=>{ const f=e.target.files[0]; if(!f) return; try{ const txt=await f.text(); const data=JSON.parse(txt); stopTransport(); $('#trackList').innerHTML=''; S.tracks.length=0; S.markers = data.markers||[]; $('#markers').innerHTML=''; for(const m of (data.markers||[])){ const b=document.createElement('button'); b.className='marker'; b.textContent='📍 '+fmtTime(m); b.addEventListener('click',()=>setPos(m)); $('#markers').appendChild(b);} S.bpm = data.bpm||90; const bpmEl=$('#bpm'); if(bpmEl) bpmEl.value=S.bpm; for(const tr of (data.tracks||[])){ if(tr.kind==='instrument'){ const it=new InstrumentTrack(tr.name||'Instrumento'); it.gain=tr.gain||0.6; it.pan=tr.pan||0; it.notes=tr.notes||[]; S.tracks.push(it); addTrackUI(it); } else { const at=new AudioTrack((tr.name||'Audio')+' (relink requerido)', null); at.gain=tr.gain||0.9; at.pan=tr.pan||0; S.tracks.push(at); addTrackUI(at); } }
      if (data.mix){ const m=data.mix; const mg=$('#masterGain'); if(m.master!=null && mg){ mg.value=String(m.master); if(S.masterGain) S.masterGain.gain.value = +m.master; }
        if(m.buses && S.fx){ if(m.buses.reverb){ S.fx.reverb.level=m.buses.reverb.level||0; S.fx.reverb.decay=m.buses.reverb.decay||2.4; S.fx.reverb.wet.gain.value=S.fx.reverb.level; S.fx.reverb.convolver.buffer=createIR(S.ctx, S.fx.reverb.decay); }
          if(m.buses.delay){ S.fx.delay.level=m.buses.delay.level||0; S.fx.delay.time=m.buses.delay.time||0.28; S.fx.delay.fb=m.buses.delay.fb||0.3; S.fx.delay.wet.gain.value=S.fx.delay.level; S.fx.delay.delay.delayTime.value=S.fx.delay.time; S.fx.delay.feedback.gain.value=S.fx.delay.fb; } }
        if(Array.isArray(m.tracks)){
          m.tracks.forEach((mt,i)=>{ const tr=S.tracks[i]; if(!tr) return; tr.mute=!!mt.mute; tr.solo=!!mt.solo; tr.gain=mt.gain??tr.gain; tr.pan=mt.pan??tr.pan; tr.sendA=mt.sendA||0; tr.sendB=mt.sendB||0; if(mt.eq){ tr.eq.enabled=!!mt.eq.enabled; tr.eq.hpf.freq=mt.eq.hpf?.freq??tr.eq.hpf.freq; tr.eq.hpf.q=mt.eq.hpf?.q??tr.eq.hpf.q; tr.eq.peak.freq=mt.eq.peak?.freq??tr.eq.peak.freq; tr.eq.peak.gain=mt.eq.peak?.gain??tr.eq.peak.gain; tr.eq.peak.q=mt.eq.peak?.q??tr.eq.peak.q; tr.eq.lpf.freq=mt.eq.lpf?.freq??tr.eq.lpf.freq; tr.eq.lpf.q=mt.eq.lpf?.q??tr.eq.lpf.q; }
            if(mt.comp){ tr.comp.enabled=!!mt.comp.enabled; tr.comp.threshold = mt.comp.threshold??tr.comp.threshold; tr.comp.ratio = mt.comp.ratio??tr.comp.ratio; tr.comp.attack = mt.comp.attack??tr.comp.attack; tr.comp.release = mt.comp.release??tr.comp.release; tr.comp.makeup = mt.comp.makeup??tr.comp.makeup; }
          });
        }
      }
      renderMixer();
      applyMuteSolo();
    }catch{ alert('Archivo de proyecto no válido'); } e.target.value=''; });

    $('#btnMon').addEventListener('click', toggleMonitor);
    $('#btnRec').addEventListener('click', recordToggle);
    $('#btnAudition').addEventListener('click', ()=>{ if (S.media.lastTake){ const src=S.ctx.createBufferSource(); src.buffer=S.media.lastTake; src.connect(S.masterGain); src.start(); S.media.audition=src; } });
    $('#btnAudStop').addEventListener('click', ()=>{ try{ S.media.audition && S.media.audition.stop(); }catch{} });
    $('#audM1').addEventListener('click', ()=> setPos(getPos()-1));
    $('#audP1').addEventListener('click', ()=> setPos(getPos()+1));

    $('#openGuide').addEventListener('click', (e)=>{ e.preventDefault(); $('#guia').style.display='flex'; $('#guia').setAttribute('aria-hidden','false');});
    $('#guideClose').addEventListener('click', ()=>{ $('#guia').style.display='none'; $('#guia').setAttribute('aria-hidden','true');});
    $('#guidePrev').addEventListener('click', ()=> alert('Este es un demo de guía.'));
    $('#guideNext').addEventListener('click', ()=> alert('Este es un demo de guía.'));

    $('#themeToggle').addEventListener('click', ()=>{ document.documentElement.classList.toggle('light'); localStorage.setItem('theme', document.documentElement.classList.contains('light')?'light':'dark'); savePrefs(); });

    $('#timeline').addEventListener('click', (e)=>{ const r=e.currentTarget.getBoundingClientRect(); const x=e.clientX-r.left; const dur=Math.max(8,getProjectDuration()); const t=(x/r.width)*dur; setPos(t); });

    $('#btnViewMixer').addEventListener('click', ()=>{ $('#editView').style.display='none'; $('#mixerView').style.display='block'; renderMixer(); });
    $('#btnViewEdit').addEventListener('click', ()=>{ $('#mixerView').style.display='none'; $('#editView').style.display='grid'; });

    window.addEventListener('keydown', async (e)=>{ if (e.target.tagName==='INPUT') return; if (e.code==='Space'){ e.preventDefault(); await ensureAudio(); if (S.playing) pauseTransport(); else startTransport(); } else if (e.key==='l' || e.key==='L'){ S.loop.enabled=!S.loop.enabled; $('#loopToggle').textContent = S.loop.enabled? '🔁 ON' : '🔁 OFF'; savePrefs(); } else if (e.key==='m' || e.key==='M'){ S.metro.enabled=!S.metro.enabled; $('#metroToggle').classList.toggle('ok', S.metro.enabled); if (S.playing) scheduleMetronome(); savePrefs(); } });
  });
})();
