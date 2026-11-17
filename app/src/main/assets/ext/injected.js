(() => {
  'use strict';

  // Port of UI_FIGHTER_AMPLIFIER core/audio_utils.py.
  // Order preserved: gate -> HPF -> gain -> EQ -> volume -> raw/output boost
  // -> adaptive leveler -> dual exciter -> tanh soft limiter.
  const AUDIO_MAX_BITRATE = 160000;
  const RAW_PCM_GAIN_MULTIPLIER = 2.4;
  const OUTPUT_AUDIO_GAIN_MULTIPLIER = 8.0;
  const VOLUME_MAX = 9000;
  const MIC_MAX = 9000;
  const AUDIO_CONTROL_MAX = 9000;

  function mapVolumeToGain(value) {
    const level = Math.max(1, Math.min(VOLUME_MAX, Number(value) || 1));
    return 0.35 + (level / 2400) * 4.65;
  }

  function mapGainToFactor(value) {
    const level = Math.max(0, Math.min(MIC_MAX, Number(value) || 0));
    return 1.0 + (level / 2000) * 6.0;
  }

  function mapControlToDb(value) {
    const level = Math.max(0, Math.min(AUDIO_CONTROL_MAX, Number(value) || 0));
    return -12 + (level / 4000) * 30.0;
  }

  function boostOpusSdp(sdp) {
    if (typeof sdp !== 'string' || !sdp.includes('m=audio')) return sdp;
    return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*)/g, (line, pt, params) => {
      const hasOpus = new RegExp(`a=rtpmap:${pt} opus`, 'i').test(sdp);
      if (!hasOpus) return line;
      const extra = ['maxaveragebitrate=160000', 'useinbandfec=1', 'usedtx=0'];
      const add = extra.filter(kv => !new RegExp(`(^|;)\\s*${kv.split('=')[0]}=`, 'i').test(params));
      return add.length ? `${line};${add.join(';')}` : line;
    });
  }

  function patchPeerConnectionAudio() {
    const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!PC || !PC.prototype || PC.prototype.__blazeBotPatched) return;

    for (const name of ['createOffer', 'createAnswer']) {
      const original = PC.prototype[name];
      if (typeof original !== 'function') continue;
      PC.prototype[name] = function (...args) {
        return original.apply(this, args).then(desc => {
          try {
            if (desc && desc.sdp) {
              return new RTCSessionDescription({ type: desc.type, sdp: boostOpusSdp(desc.sdp) });
            }
          } catch (_) {}
          return desc;
        });
      };
    }

    for (const name of ['setLocalDescription', 'setRemoteDescription']) {
      const original = PC.prototype[name];
      if (typeof original !== 'function') continue;
      PC.prototype[name] = function (desc) {
        try {
          if (desc && desc.sdp) {
            desc = new RTCSessionDescription({ type: desc.type, sdp: boostOpusSdp(desc.sdp) });
          }
        } catch (_) {}
        return original.call(this, desc);
      };
    }

    const originalAddTrack = PC.prototype.addTrack;
    if (typeof originalAddTrack === 'function') {
      PC.prototype.addTrack = function (track, ...streams) {
        const sender = originalAddTrack.call(this, track, ...streams);
        if (track && track.kind === 'audio' && sender && typeof sender.getParameters === 'function') {
          try {
            const params = sender.getParameters();
            params.encodings = (params.encodings && params.encodings.length ? params.encodings : [{}]).map(enc => ({
              ...enc,
              maxBitrate: Math.max(enc.maxBitrate || 0, AUDIO_MAX_BITRATE)
            }));
            sender.setParameters(params).catch(() => {});
          } catch (_) {}
        }
        return sender;
      };
    }
    PC.prototype.__blazeBotPatched = true;
  }

  try { patchPeerConnectionAudio(); } catch (_) {}

  let audioContext = null;
  let currentSettings = {
    volume: 3000,
    micGain: 2500,
    bass: 175,
    treble: 400,
    sharpness: 400,
    echo: 15,
    noiseGate: 0,
    compression: 55,
    limiter: 80,
    power: true
  };

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'AUDIO_SETTINGS_UPDATE') {
      currentSettings = { ...currentSettings, ...event.data.settings };
    }
  });

  const lastTargets = new WeakMap();
  function smoothSet(param, value, timeConstant = 0.06) {
    if (!audioContext || !param) return;
    const previous = lastTargets.get(param);
    if (previous !== undefined && Math.abs(previous - value) < 0.0005) return;
    lastTargets.set(param, value);
    param.setTargetAtTime(value, audioContext.currentTime, timeConstant);
  }

  function makeBotBassCurve() {
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.75);
    }
    return curve;
  }

  function makeBotTrebleCurve() {
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.0);
    }
    return curve;
  }

  function makeBotSoftClipCurve() {
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.05) * 0.95;
    }
    return curve;
  }

  function makeBotFinalCurve() {
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 10.0) * 0.995;
    }
    return curve;
  }

  function processAudioStream(originalStream) {
    try {
      if (!audioContext) {
        try {
          audioContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive',
            sampleRate: 48000
          });
        } catch (_) {
          audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        }
      }
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

      const source = audioContext.createMediaStreamSource(originalStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      const rmsBuffer = new Float32Array(analyser.fftSize);

      // Bot: HPF 40 Hz and body boost at 400 Hz (+3 dB).
      const hpf = audioContext.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = 40; hpf.Q.value = 0.707;
      const body = audioContext.createBiquadFilter();
      body.type = 'peaking'; body.frequency.value = 400; body.Q.value = 0.707; body.gain.value = 3;

      // Bot EQ: bass shelf 180 Hz, sharpness 2800 Hz, treble shelf 5500 Hz.
      const bass = audioContext.createBiquadFilter();
      bass.type = 'lowshelf'; bass.frequency.value = 180; bass.Q.value = 0.707;
      const sharpness = audioContext.createBiquadFilter();
      sharpness.type = 'peaking'; sharpness.frequency.value = 2800; sharpness.Q.value = 0.9;
      const treble = audioContext.createBiquadFilter();
      treble.type = 'highshelf'; treble.frequency.value = 5500; treble.Q.value = 0.8;

      const micGain = audioContext.createGain();
      const volumeGain = audioContext.createGain();
      const rawOutputGain = audioContext.createGain();
      const levelerGain = audioContext.createGain();
      micGain.gain.value = mapGainToFactor(currentSettings.micGain);
      volumeGain.gain.value = mapVolumeToGain(currentSettings.volume);
      rawOutputGain.gain.value = RAW_PCM_GAIN_MULTIPLIER * OUTPUT_AUDIO_GAIN_MULTIPLIER;
      levelerGain.gain.value = 1;

      // Bot _DualExciter: restrained bass harmonic + treble harmonic, with a
      // 78/22 processed/dry blend so consonants and word edges remain present.
      const bassTap = audioContext.createBiquadFilter();
      bassTap.type = 'lowpass'; bassTap.frequency.value = 300; bassTap.Q.value = 0.707;
      const bassExciter = audioContext.createWaveShaper();
      bassExciter.curve = makeBotBassCurve(); bassExciter.oversample = '2x';
      const bassAmount = audioContext.createGain(); bassAmount.gain.value = 0.06;

      const trebleTap = audioContext.createBiquadFilter();
      trebleTap.type = 'highpass'; trebleTap.frequency.value = 3000; trebleTap.Q.value = 0.707;
      const trebleExciter = audioContext.createWaveShaper();
      trebleExciter.curve = makeBotTrebleCurve(); trebleExciter.oversample = '2x';
      const trebleAmount = audioContext.createGain(); trebleAmount.gain.value = 0.12;

      const processedGain = audioContext.createGain(); processedGain.gain.value = 0.78;
      const dryGain = audioContext.createGain(); dryGain.gain.value = 0.22;
      const exciterBus = audioContext.createGain(); exciterBus.gain.value = 1;
      const botSoftClip = audioContext.createWaveShaper();
      botSoftClip.curve = makeBotSoftClipCurve();
      botSoftClip.oversample = '2x';
      const compressor = audioContext.createDynamicsCompressor();
      compressor.knee.value = 24;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      compressor.ratio.value = 8;
      const limiter = audioContext.createDynamicsCompressor();
      limiter.knee.value = 0;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      limiter.ratio.value = 20;
      limiter.threshold.value = -1;
      const amplifiedOut = audioContext.createGain();
      const cleanOut = audioContext.createGain();

      // Adjustable echo: short delay with bounded feedback for a controllable repeat effect.
      const echoDelay = audioContext.createDelay(0.6);
      echoDelay.delayTime.value = 0.16;
      const echoFeedback = audioContext.createGain();
      const echoWet = audioContext.createGain();
      echoFeedback.gain.value = 0.22;
      echoWet.gain.value = 0.08;
      amplifiedOut.gain.value = 1;
      cleanOut.gain.value = 0;

      const finalLimiter = audioContext.createWaveShaper();
      finalLimiter.curve = makeBotFinalCurve();
      finalLimiter.oversample = '2x';

      // Exact bot-inspired signal order.
      source.connect(hpf);
      hpf.connect(body);
      body.connect(micGain);
      micGain.connect(bass);
      bass.connect(sharpness);
      sharpness.connect(treble);
      treble.connect(volumeGain);
      volumeGain.connect(rawOutputGain);
      rawOutputGain.connect(levelerGain);

      levelerGain.connect(processedGain);
      processedGain.connect(exciterBus);
      levelerGain.connect(dryGain);
      dryGain.connect(exciterBus);
      levelerGain.connect(bassTap);
      bassTap.connect(bassExciter);
      bassExciter.connect(bassAmount);
      bassAmount.connect(exciterBus);
      levelerGain.connect(trebleTap);
      trebleTap.connect(trebleExciter);
      trebleExciter.connect(trebleAmount);
      trebleAmount.connect(exciterBus);
      exciterBus.connect(botSoftClip);
      botSoftClip.connect(compressor);
      compressor.connect(limiter);
      limiter.connect(finalLimiter);
      finalLimiter.connect(amplifiedOut);
      finalLimiter.connect(echoDelay);
      echoDelay.connect(echoFeedback);
      echoFeedback.connect(echoDelay);
      echoDelay.connect(echoWet);
      echoWet.connect(amplifiedOut);
      source.connect(cleanOut);

      const destination = audioContext.createMediaStreamDestination();
      amplifiedOut.connect(destination);
      cleanOut.connect(destination);
      originalStream.getVideoTracks().forEach(track => destination.stream.addTrack(track));

      let rmsEnv = 0;
      let levelerGainValue = 1.2;
      const updateLoop = setInterval(() => {
        const s = currentSettings;
        smoothSet(volumeGain.gain, mapVolumeToGain(s.volume), 0.06);
        smoothSet(micGain.gain, mapGainToFactor(s.micGain), 0.06);
        smoothSet(bass.gain, mapControlToDb(s.bass), 0.06);
        smoothSet(sharpness.gain, mapControlToDb(s.sharpness), 0.06);
        smoothSet(treble.gain, mapControlToDb(s.treble), 0.06);
        const echo = Math.max(0, Math.min(100, Number(s.echo) || 0));
        smoothSet(echoWet.gain, echo === 0 ? 0 : echo /500 * 0.42, 0.08);
        smoothSet(echoFeedback.gain, echo === 0 ? 0 : 0.10 + echo /500 * 0.30, 0.08);
        smoothSet(echoDelay.delayTime, 0.10 + echo /500 * 0.30, 0.08);

        // Compression/limiting controls. Higher slider = stronger dynamics control.
        const comp = Math.max(0, Math.min(100, Number(s.compression) || 0));
        const lim = Math.max(0, Math.min(100, Number(s.limiter) || 0));
        smoothSet(compressor.threshold, comp === 0 ? 0 : -6 - comp * 0.54, 0.08);
        smoothSet(compressor.ratio, comp === 0 ? 1 : 1 + comp * 0.19, 0.08);
        smoothSet(limiter.threshold, lim === 0 ? 0 : -1 - lim * 0.24, 0.08);
        smoothSet(amplifiedOut.gain, s.power === false ? 0 : 1, 0.04);
        smoothSet(cleanOut.gain, s.power === false ? 1 : 0, 0.04);

        // Bot _AdaptiveSpeechLeveler: target RMS .68, min gain 1x, max gain 10x,
        // 75 ms attack and 240 ms release. Gate remains transparent by default.
        const gateThreshold = Math.max(0, Math.min(100, Number(s.noiseGate) || 0)) /500 * 0.08;
        analyser.getFloatTimeDomainData(rmsBuffer);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < rmsBuffer.length; i++) {
          const sample = rmsBuffer[i];
          sum += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
        const rms = Math.sqrt(sum / rmsBuffer.length);
        const displayLevel = Math.max(0, Math.min(100, 20 * Math.log10(Math.max(rms, 0.00001)) + 100));
        window.postMessage({ type: 'AUDIO_LEVEL', level: displayLevel }, '*');
        const frameDt = 0.06;
        const envCoeff = Math.exp(-frameDt / 0.06);
        rmsEnv = envCoeff * rmsEnv + (1 - envCoeff) * rms;
        let desired = 1;
        if (rmsEnv > 1e-5) desired = Math.max(1, Math.min(20, 0.68 / rmsEnv));
        if (gateThreshold > 0 && peak < gateThreshold && rmsEnv < gateThreshold) desired = 0;
        const attack = desired > levelerGainValue;
        const timeConstant = attack ? 0.075 : 0.24;
        const coeff = Math.exp(-frameDt / timeConstant);
        levelerGainValue = coeff * levelerGainValue + (1 - coeff) * desired;
        smoothSet(levelerGain.gain, levelerGainValue, 0.06);
      }, 60);

      const stop = () => clearInterval(updateLoop);
      originalStream.getTracks().forEach(track => track.addEventListener('ended', stop, { once: true }));
      window.postMessage({ type: 'AUDIO_STATUS', status: 'UI_FIGHTER_AMPLIFIER_AUDIO_ACTIVE' }, '*');
      console.log('[UI FIGHTER] Amplifier audio pipeline active');
      return destination.stream;
    } catch (error) {
      console.error('[UI FIGHTER] Audio error:', error);
      return originalStream;
    }
  }

  function rawMicConstraints(audio) {
    const base = audio && typeof audio === 'object' ? audio : {};
    return {
      ...base,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      googEchoCancellation: false,
      googAutoGainControl: false,
      googNoiseSuppression: false,
      googHighpassFilter: false,
      googTypingNoiseDetection: false,
      mozAutoGainControl: false,
      mozNoiseSuppression: false,
      sampleRate: { ideal: 48000 }
    };
  }

  function withRawMicConstraints(constraints) {
    if (!constraints || !constraints.audio) return constraints;
    return { ...constraints, audio: rawMicConstraints(constraints.audio) };
  }

  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    let stream;
    try {
      stream = await originalGetUserMedia(withRawMicConstraints(constraints));
    } catch (_) {
      stream = await originalGetUserMedia(constraints);
    }
    return constraints && constraints.audio ? processAudioStream(stream) : stream;
  };

  if (navigator.getUserMedia) {
    const legacyGetUserMedia = navigator.getUserMedia.bind(navigator);
    navigator.getUserMedia = function (constraints, success, failure) {
      legacyGetUserMedia(constraints, stream => {
        success(constraints && constraints.audio ? processAudioStream(stream) : stream);
      }, failure);
    };
  }

  console.log('[UI FIGHTER] READY — UI FIGHTER amplifier');
})();
