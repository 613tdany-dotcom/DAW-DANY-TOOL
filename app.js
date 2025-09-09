/* DAW DANY TOOL — v1.1 (desde cero, sin dependencias) */
(() => {
  const $ = sel => document.querySelector(sel);
  const log = (...args) => { const el = $('#console'); const d = document.createElement('div'); d.textContent = args.map(a => typeof a==='object'? JSON.stringify(a): String(a)).join(' '); el.prepend(d); };
  const fmtTime = s => (Math.max(0, s)||0).toFixed(1) + 's';

  // Reloj RD (UTC-4)
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

  // ===== Estado de audio =====
  const S = {
    ctx: null, masterGain: null, analyser: null,
    playing:false, startTime:0, pauseOffset:0,
    loop:{enabled:false,start:0,end:8}, bpm:90,
    metro:{enabled:false,gain:null,tickBuf:null,nextTime:0},
    tracks:[], markers:[],
    media:{stream:null,source:null,monitor:false,recorder:null,chunks:[],lastTake:null,audition:null}
  };

  async function ensureAudio(){
    if (S.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { alert('WebAudio no disponible en este navegador.'); return; }
    const ctx = new AC({ latencyHint:'interactive' });
    const master = ctx.createGain(); master.gain.value = 0.85;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    master.connect(analyser); analyser.connect(ctx.destination);
    const metroGain = ctx.createGain(); metroGain.gain.value = 0; metroGain.connect(master);

    S.ctx = ctx; S.masterGain = master; S.analyser = analyser; S.metro.gain = metroGain;
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

  function getPos(){ if (!S.ctx) return 0; return S.playing ? (S.ctx.currentTime - S.startTime) : S.pauseOffset; }
  function setPos(seconds){ S.pauseOffset = Math.max(0, seconds); if (S.playing){ stopTracks(); S.startTime = S.ctx.currentTime - S.pauseOffset; for (const tr of S.tracks){ tr.start(); } } updatePosUI(); }
  function updatePosUI(){ const p = getPos(); $('#pos').textContent = fmtTime(p); $('#takePos').textContent = fmtTime(p); const tl=$('#timeline'), ph=$('#playhead'); const dur=Math.max(8,getProjectDuration()); const x=Math.min(1,p/dur)*tl.clientWidth; ph.style.left = x+'px'; if (S.loop.enabled && p >= S.loop.end){ setPos(S.loop.start); } }
  function rafPos(){ updatePosUI(); if (S.playing) requestAnimationFrame(rafPos); }

  function getProjectDuration(){ let d=0; for (const tr of S.tracks){ d=Math.max(d, tr.getDuration()); } return d; }

  // ===== Clases de pista =====
  class AudioTrack{
    constructor(name, buf){ this.kind='audio'; this.name=name; this.buf=buf; this.gain=0.9; this.pan=0; this.node=null; this.gainNode=null; this.panNode=null; this.canvas=null; }
    attachCanvas(canvas){ this.canvas=canvas; this.drawWaveform(); }
    drawWaveform(){ if(!this.canvas||!this.buf) return; const c=this.canvas.getContext('2d'); const W=this.canvas.width=this.canvas.clientWidth*devicePixelRatio; const H=this.canvas.height=this.canvas.clientHeight*devicePixelRatio; c.clearRect(0,0,W,H); c.fillStyle='#0b0d12'; c.fillRect(0,0,W,H); c.strokeStyle='#6ee7ff'; c.lineWidth=1; const data=this.buf.getChannelData(0); const step=Math.max(1, Math.floor(data.length/W)); c.beginPath(); for(let x=0;x<W;x++){ let min=1,max=-1; const i0=x*step, i1=Math.min(data.length,i0+step); for(let i=i0;i<i1;i++){ const v=data[i]; if(v<min)min=v; if(v>max)max=v; } const y1=(1-(max+1)/2)*H, y2=(1-(min+1)/2)*H; c.moveTo(x,y1); c.lineTo(x,y2); } c.stroke(); }
    _build(){ const ctx=S.ctx; const src=ctx.createBufferSource(); src.buffer=this.buf; const g=ctx.createGain(); g.gain.value=this.gain; let out=g; if (ctx.createStereoPanner){ const p=ctx.createStereoPanner(); p.pan.value=this.pan; g.connect(p); out=p; } src.connect(g); out.connect(S.masterGain); this.node=src; this.gainNode=g; }
    start(){ this._build(); const when=S.ctx.currentTime; const off=getPos(); const posInBuf=Math.min(this.buf.duration, off); this.node.start(when, posInBuf); }
    stop(){ try{ this.node && this.node.stop(); }catch{} this.node=null; }
    getDuration(){ return this.buf? this.buf.duration : 0; }
  }
  class InstrumentTrack{
    constructor(name='Instrumento'){ this.kind='instrument'; this.name=name; this.notes=[]; this.gain=0.6; this.pan=0; this.gainNode=null; this.canvas=null; }
    attachCanvas(c){ this.canvas=c; this.drawWaveform(); }
    drawWaveform(){ if(!this.canvas) return; const c=this.canvas.getContext('2d'); const W=this.canvas.width=this.canvas.clientWidth*devicePixelRatio; const H=this.canvas.height=this.canvas.clientHeight*devicePixelRatio; c.clearRect(0,0,W,H); c.fillStyle='#0b0d12'; c.fillRect(0,0,W,H); c.fillStyle='#8b5cf6'; for(const n of this.notes){ const x=(n.t/Math.max(8,getProjectDuration()))*W; c.fillRect(x, H-20, 8*devicePixelRatio, 18); } }
    _graph(){ const ctx=S.ctx; const g=ctx.createGain(); g.gain.value=this.gain; let out=g; if (ctx.createStereoPanner){ const p=ctx.createStereoPanner(); p.pan.value=this.pan; g.connect(p); out=p; } out.connect(S.masterGain); this.gainNode=g; }
    start(){ this._graph(); const ctx=S.ctx; const offset=getPos(); const base=ctx.currentTime - offset; for(const n of this.notes){ const osc=ctx.createOscillator(); osc.type='sine'; osc.frequency.value = 220*Math.pow(2,(n.m-1)/12); const env=ctx.createGain(); env.gain.value=0; osc.connect(env); env.connect(this.gainNode); const t=base+n.t; env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.005); env.gain.exponentialRampToValueAtTime(0.0001, t+Math.max(0.12,n.d||0.25)); osc.start(t); osc.stop(t+Math.max(0.12,n.d||0.25)+0.05); } }
    stop(){ /* osciladores auto-paran */ }
    getDuration(){ let d=0; for(const n of this.notes){ d=Math.max(d, n.t+(n.d||0.25)); } return d; }
  }

  // ===== Control transporte =====
  async function startTransport(){ await ensureAudio(); S.playing=true; S.startTime = S.ctx.currentTime - S.pauseOffset; for(const tr of S.tracks){ tr.start(); } if (S.metro.enabled){ S.metro.nextTime = S.ctx.currentTime + 0.05; scheduleMetronome(); S.metro.gain.gain.setTargetAtTime(0.7, S.ctx.currentTime, 0.01); } rafPos(); }
  function pauseTransport(){ if (!S.ctx) return; S.playing=false; S.pauseOffset=getPos(); stopTracks(); S.metro.gain.gain.setTargetAtTime(0, S.ctx.currentTime, 0.01); }
  function stopTransport(){ if (!S.ctx) return; S.playing=false; S.pauseOffset=0; stopTracks(); setPos(0); S.metro.gain.gain.setTargetAtTime(0, S.ctx.currentTime, 0.01); }
  function stopTracks(){ for(const tr of S.tracks){ tr.stop(); } }

  // ===== Metrónomo =====
  function scheduleMetronome(){ const ctx=S.ctx; if(!ctx) return; const bps=S.bpm/60; const interval=1/bps; const look=0.1; const ahead=0.2; const now=ctx.currentTime; if (S.metro.nextTime < now) S.metro.nextTime = now + 0.05; while (S.metro.nextTime < now + ahead){ const t=S.metro.nextTime; const src=ctx.createBufferSource(); src.buffer=S.metro.tickBuf; src.connect(S.metro.gain); src.start(t); S.metro.nextTime += interval; } if (S.playing && S.metro.enabled){ setTimeout(scheduleMetronome, look*1000); } }

  // ===== Analizador / nivel =====
  function drawAnalyzer(){ const cvs=$('#analyzer'); const c=cvs.getContext('2d'); function loop(){ if(!S.analyser){ requestAnimationFrame(loop); return; } const W=cvs.width=cvs.clientWidth*devicePixelRatio; const H=cvs.height=cvs.clientHeight*devicePixelRatio; const data=new Uint8Array(S.analyser.frequencyBinCount); S.analyser.getByteFrequencyData(data); c.clearRect(0,0,W,H); const barW=Math.max(1, Math.floor(W/data.length)); for(let i=0;i<data.length;i++){ const v=data[i]/255; const h=v*H; const x=i*barW; const grad=c.createLinearGradient(0,0,0,H); grad.addColorStop(0,'#6ee7ff'); grad.addColorStop(1,'#8b5cf6'); c.fillStyle=grad; c.fillRect(x, H-h, barW-1, h); }
    const td=new Float32Array(S.analyser.fftSize); S.analyser.getFloatTimeDomainData(td); let peak=0,sum=0; for(const s of td){ const a=Math.abs(s); if(a>peak) peak=a; sum+=s*s; } const rms=Math.sqrt(sum/td.length); const peakDb=20*Math.log10(peak||1e-6); const rmsDb=20*Math.log10(rms||1e-6); $('#peak').textContent=peakDb.toFixed(1)+' dBFS'; $('#lufs').textContent=(rmsDb).toFixed(1); requestAnimationFrame(loop); }
    loop(); }

  // ===== Marcadores =====
  function addMarker(){ const t=getPos(); const list=$('#markers'); const b=document.createElement('button'); b.className='marker'; b.textContent='📍 '+fmtTime(t); b.addEventListener('click',()=>setPos(t)); list.appendChild(b); S.markers.push(t); }

  // ===== Micrófono =====
  async function initMic(){ try{ const stream=await navigator.mediaDevices.getUserMedia({audio:true}); const src=S.ctx.createMediaStreamSource(stream); S.media.stream=stream; S.media.source=src; log('Micrófono listo.'); }catch(err){ log('Error micrófono:', err.message||err); alert('Permite el micrófono para grabar.'); } }
  async function toggleMonitor(){ await ensureAudio(); if(!S.media.stream) await initMic(); if(!S.media.stream) return; S.media.monitor=!S.media.monitor; if(S.media.monitor){ S.media.source.connect(S.masterGain); } else { try{ S.media.source.disconnect(S.masterGain);}catch{} } $('#btnMon').classList.toggle('ok', S.media.monitor); }
  async function recordToggle(){ await ensureAudio(); if(!S.media.stream) await initMic(); if(!S.media.stream) return; if(!S.media.recorder){ S.media.recorder = new MediaRecorder(S.media.stream); S.media.recorder.ondataavailable = e=> S.media.chunks.push(e.data); S.media.recorder.onstop = onTakeReady; }
    if (S.media.recorder.state === 'recording'){ S.media.recorder.stop(); $('#btnRec').textContent='🎙️ Grabar'; } else { S.media.chunks=[]; S.media.recorder.start(); $('#btnRec').textContent='⏺️ Grabando…'; } }
  async function onTakeReady(){ const blob = new Blob(S.media.chunks, {type:'audio/webm'}); const arr = await blob.arrayBuffer(); const buf = await S.ctx.decodeAudioData(arr); S.media.lastTake = buf; const tr = new AudioTrack('Toma de mic', buf); S.tracks.push(tr); addTrackUI(tr); log('Toma agregada como pista.'); }

  // ===== Pistas =====
  async function addAudioFile(file){ await ensureAudio(); const arr=await file.arrayBuffer(); const buf=await S.ctx.decodeAudioData(arr); const tr=new AudioTrack(file.name.replace(/\.[^/.]+$/,''), buf); S.tracks.push(tr); addTrackUI(tr); log('Pista añadida:', tr.name); }
  function addInstrumentTrack(){ const tr = new InstrumentTrack('Instrumento'); const bps=S.bpm/60; for(let i=0;i<8;i++){ tr.notes.push({ t:i*(1/bps), m:(i%2?4:7), d:0.18 }); } S.tracks.push(tr); addTrackUI(tr); log('Pista instrumento añadida.'); }

  function addTrackUI(track){ const list=$('#trackList'); const row=document.createElement('div'); row.className='track'; row.innerHTML = `<div>🎚️</div><div><div class="name">${track.name}</div><div class="wave"><canvas></canvas></div></div><div style="display:flex;flex-direction:column;gap:6px;"><label>Vol <input class="vol" type="range" min="0" max="1" step="0.01" value="${track.gain}"></label><label>Pan <input class="pan" type="range" min="-1" max="1" step="0.01" value="${track.pan||0}"></label></div>`; list.appendChild(row); const canvas=row.querySelector('canvas'); track.attachCanvas(canvas); const vol=row.querySelector('.vol'), pan=row.querySelector('.pan'); vol.addEventListener('input', e=>{ track.gain=+e.target.value; if(track.gainNode) track.gainNode.gain.value=track.gain; }); pan.addEventListener('input', e=>{ track.pan=+e.target.value; if(track.panNode) track.panNode.pan.value=track.pan; }); }

  // ===== Exportación WAV =====
  async function exportMix(){ await ensureAudio(); if (!S.ctx) return; const sr=S.ctx.sampleRate; const dur=Math.max(1, getProjectDuration()); const off=new OfflineAudioContext(2, Math.ceil(dur*sr), sr); const master=off.createGain(); master.gain.value = $('#masterGain').value; master.connect(off.destination);
    for(const tr of S.tracks){ if(tr.kind==='audio'){ const src=off.createBufferSource(); src.buffer=tr.buf; const g=off.createGain(); g.gain.value=tr.gain; let out=g; if (off.createStereoPanner){ const p=off.createStereoPanner(); p.pan.value=tr.pan; g.connect(p); out=p; } src.connect(g); out.connect(master); src.start(0); } else if (tr.kind==='instrument'){ const g=off.createGain(); g.gain.value=tr.gain; let out=g; if (off.createStereoPanner){ const p=off.createStereoPanner(); p.pan.value=tr.pan; g.connect(p); out=p; } out.connect(master); for(const n of tr.notes){ const osc=off.createOscillator(); osc.type='sine'; osc.frequency.value=220*Math.pow(2,(n.m-1)/12); const env=off.createGain(); env.gain.value=0; osc.connect(env); env.connect(g); const t=n.t; env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.005); env.gain.exponentialRampToValueAtTime(0.0001, t+Math.max(0.12,n.d||0.25)); osc.start(t); osc.stop(t+Math.max(0.12,n.d||0.25)+0.05); } } }
    if (S.metro.enabled){ const tick=S.metro.tickBuf; const bps=S.bpm/60; let t=0; while(t<dur){ const src=off.createBufferSource(); src.buffer=tick; src.connect(master); src.start(t); t += 1/bps; } }
    const buf = await off.startRendering(); const wav = audioBufferToWav(buf); const url=URL.createObjectURL(new Blob([wav],{type:'audio/wav'})); const a=document.createElement('a'); a.href=url; a.download='daw_dany_mix.wav'; a.click(); }

  function audioBufferToWav(buffer){ const numCh=buffer.numberOfChannels; const length=buffer.length * numCh * 2 + 44; const buf=new ArrayBuffer(length); const view=new DataView(buf); write(view,0,'RIFF'); view.setUint32(4,36 + buffer.length * numCh * 2, true); write(view,8,'WAVE'); write(view,12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,numCh,true); view.setUint32(24,buffer.sampleRate,true); view.setUint32(28,buffer.sampleRate*2*numCh,true); view.setUint16(32,numCh*2,true); view.setUint16(34,16,true); write(view,36,'data'); view.setUint32(40, buffer.length * numCh * 2, true); let off=44; for(let i=0;i<buffer.length;i++){ for(let ch=0; ch<numCh; ch++){ let s=buffer.getChannelData(ch)[i]; s = Math.max(-1, Math.min(1, s)); view.setInt16(off, s<0 ? s*0x8000 : s*0x7FFF, true); off+=2; } } return buf; }
  function write(v, off, str){ for(let i=0;i<str.length;i++){ v.setUint8(off+i, str.charCodeAt(i)); } }

  // ===== Enlaces UI =====
  document.addEventListener('DOMContentLoaded', () => {
    // Transporte
    $('#btnPlay').addEventListener('click', startTransport);
    $('#btnPause').addEventListener('click', pauseTransport);
    $('#btnStop').addEventListener('click', stopTransport);
    $('#seekM5').addEventListener('click', () => setPos(getPos()-5));
    $('#seekM1').addEventListener('click', () => setPos(getPos()-1));
    $('#seekP1').addEventListener('click', () => setPos(getPos()+1));
    $('#seekP5').addEventListener('click', () => setPos(getPos()+5));
    $('#loopToggle').addEventListener('click', e=>{ S.loop.enabled=!S.loop.enabled; e.target.textContent = S.loop.enabled? '🔁 ON':'🔁 OFF'; });
    $('#loopStart').addEventListener('input', e=> S.loop.start = +e.target.value);
    $('#loopEnd').addEventListener('input', e=> S.loop.end = +e.target.value);
    $('#bpm').addEventListener('input', e=> S.bpm = +e.target.value);
    $('#metroToggle').addEventListener('click', (e)=>{ S.metro.enabled=!S.metro.enabled; e.target.classList.toggle('ok', S.metro.enabled); if (S.playing) scheduleMetronome(); });
    $('#addMarker').addEventListener('click', addMarker);

    // Pistas
    $('#addAudio').addEventListener('change', e=>{ const f=e.target.files[0]; if(f) addAudioFile(f); e.target.value=''; });
    $('#addInstrument').addEventListener('click', addInstrumentTrack);

    // Master
    $('#masterGain').addEventListener('input', e=>{ if (S.masterGain) S.masterGain.gain.value = +e.target.value; });

    // Proyecto
    $('#exportMix').addEventListener('click', exportMix);
    $('#clearAll').addEventListener('click', ()=>{ stopTransport(); S.tracks.length=0; $('#trackList').innerHTML=''; $('#markers').innerHTML=''; S.markers=[]; log('Proyecto limpio.'); });
    $('#saveJson').addEventListener('click', ()=>{ const data={ bpm:S.bpm, markers:S.markers, tracks:S.tracks.map(tr=>({ kind:tr.kind, name:tr.name, gain:tr.gain, pan:tr.pan, notes: tr.notes||[] })) }; const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='proyecto_daw_dany.json'; a.click(); });
    $('#loadJson').addEventListener('change', async (e)=>{ const f=e.target.files[0]; if(!f) return; try{ const txt=await f.text(); const data=JSON.parse(txt); stopTransport(); $('#trackList').innerHTML=''; S.tracks.length=0; S.markers = data.markers||[]; $('#markers').innerHTML=''; for(const m of S.markers){ const b=document.createElement('button'); b.className='marker'; b.textContent='📍 '+fmtTime(m); b.addEventListener('click',()=>setPos(m)); $('#markers').appendChild(b);} S.bpm = data.bpm||90; $('#bpm').value=S.bpm; for(const tr of (data.tracks||[])){ if(tr.kind==='instrument'){ const it=new InstrumentTrack(tr.name||'Instrumento'); it.gain=tr.gain||0.6; it.pan=tr.pan||0; it.notes=tr.notes||[]; S.tracks.push(it); addTrackUI(it); } else { const at=new AudioTrack((tr.name||'Audio')+' (relink requerido)', null); S.tracks.push(at); addTrackUI(at); log('⚠️ Relaciona el audio original con «➕ Pista de audio» para esta pista:', at.name); } } }catch{ alert('Archivo de proyecto no válido'); } e.target.value=''; });

    // Grabación
    $('#btnMon').addEventListener('click', toggleMonitor);
    $('#btnRec').addEventListener('click', recordToggle);
    $('#btnAudition').addEventListener('click', ()=>{ if (S.media.lastTake){ const src=S.ctx.createBufferSource(); src.buffer=S.media.lastTake; src.connect(S.masterGain); src.start(); S.media.audition=src; } });
    $('#btnAudStop').addEventListener('click', ()=>{ try{ S.media.audition && S.media.audition.stop(); }catch{} });
    $('#audM1').addEventListener('click', ()=> setPos(getPos()-1));
    $('#audP1').addEventListener('click', ()=> setPos(getPos()+1));

    // Guía
    $('#openGuide').addEventListener('click', (e)=>{ e.preventDefault(); $('#guia').style.display='flex'; $('#guia').setAttribute('aria-hidden','false');});
    $('#guideClose').addEventListener('click', ()=>{ $('#guia').style.display='none'; $('#guia').setAttribute('aria-hidden','true');});
    $('#guidePrev').addEventListener('click', ()=> alert('Este es un demo de guía.'));
    $('#guideNext').addEventListener('click', ()=> alert('Este es un demo de guía.'));

    // Tema
    $('#themeToggle').addEventListener('click', ()=>{ document.documentElement.classList.toggle('light'); });

    // Timeline click
    $('#timeline').addEventListener('click', (e)=>{ const r=e.currentTarget.getBoundingClientRect(); const x=e.clientX-r.left; const dur=Math.max(8,getProjectDuration()); const t=(x/r.width)*dur; setPos(t); });

    // Atajos
    window.addEventListener('keydown', async (e)=>{ if (e.target.tagName==='INPUT') return; if (e.code==='Space'){ e.preventDefault(); await ensureAudio(); if (S.playing) pauseTransport(); else startTransport(); } else if (e.key==='l' || e.key==='L'){ S.loop.enabled=!S.loop.enabled; $('#loopToggle').textContent = S.loop.enabled? '🔁 ON' : '🔁 OFF'; } else if (e.key==='m' || e.key==='M'){ S.metro.enabled=!S.metro.enabled; $('#metroToggle').classList.toggle('ok', S.metro.enabled); if (S.playing) scheduleMetronome(); } });
  });
})();
