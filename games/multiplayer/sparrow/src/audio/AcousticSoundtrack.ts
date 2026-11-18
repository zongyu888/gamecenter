export type SurfaceSoundType = 'stone' | 'wood' | 'metal' | 'fabric' | 'water' | 'foliage';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type MicroChirpMood = 'hop' | 'takeoff' | 'perch' | 'idle' | 'mischief';

interface ModalCell {
  bassRoot: number;
  malletScale: number[];
  motifs: number[][];
}

// Grounded modern-minimalist modal cells (Steve Reich / Nils Frahm / Penguin Cafe palette)
export const MODAL_CELLS: ModalCell[] = [
  {
    bassRoot: 87.31, // F2
    malletScale: [174.61, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33],
    motifs: [
      [0, 3, 4, 6, 3],
      [2, 5, 6, 8, 6, 5],
      [1, 3, 6, 7, 4],
      [3, 6, 4, 7, 8, 6],
    ],
  },
  {
    bassRoot: 130.81, // C3
    malletScale: [196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25],
    motifs: [
      [0, 2, 5, 3, 6],
      [2, 4, 5, 7, 5],
      [1, 5, 4, 7, 8, 5],
      [2, 5, 6, 3],
    ],
  },
  {
    bassRoot: 73.42, // D2
    malletScale: [146.83, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33],
    motifs: [
      [0, 2, 4, 6, 4],
      [2, 3, 6, 7, 5, 2],
      [1, 4, 5, 7],
      [4, 6, 7, 9, 6],
    ],
  },
  {
    bassRoot: 98.0, // G2
    malletScale: [196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0, 493.88, 587.33, 659.25],
    motifs: [
      [0, 3, 5, 6, 3],
      [1, 3, 5, 8, 5, 3],
      [0, 4, 5, 7],
      [3, 5, 6, 8, 5],
    ],
  },
];

// Curated 3D canopy & rooftop bird perches across all 4 European blocks
const OUTDOOR_CANOPY_PERCHES: ReadonlyArray<Vec3Like> = [
  { x: 36, y: 17, z: 36 },
  { x: 58, y: 19, z: 54 },
  { x: 26, y: 16, z: 62 },
  { x: -24, y: 18, z: 38 },
  { x: -16, y: 22, z: 64 },
  { x: -58, y: 16, z: -32 },
  { x: -88, y: 18, z: -68 },
  { x: 34, y: 16, z: -34 },
  { x: 64, y: 21, z: -56 },
  { x: 52, y: 28, z: -78 },
  { x: -8, y: 15, z: 12 },
  { x: 14, y: 15, z: -12 },
];

// Exterior window-side perches audible through the Attic Conservatory's East French window
const ATELIER_OUTSIDE_BIRD_PERCHES: ReadonlyArray<Vec3Like> = [
  { x: -33.5, y: 36.5, z: 48.5 },
  { x: -30.0, y: 31.0, z: 56.0 },
  { x: -34.0, y: 41.0, z: 43.0 },
  { x: -25.0, y: 24.0, z: 51.0 },
];

const GAIN_EPSILON = 0.002;
const FREQ_EPSILON = 2.0;
const POS_EPSILON = 0.12;
const MOTIF_LOOKAHEAD_SEC = 0.045;
const CRUMB_BITE_SPECS = [
  { delay: 0.0, dur: 0.058, bpFreq: 2350, popFreq: 520, amp: 0.24 },
  { delay: 0.052, dur: 0.048, bpFreq: 2820, popFreq: 610, amp: 0.19 },
  { delay: 0.105, dur: 0.042, bpFreq: 1980, popFreq: 440, amp: 0.15 },
] as const;

/**
 * 3D HRTF spatial soundscape, ambient bird chorus, foley SFX and a sparse,
 * action-driven minimalist mallet score with occasional light flourishes.
 */
export class AcousticSoundtrack {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private outdoorFilter: BiquadFilterNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private voiceIndoorFilter: BiquadFilterNode | null = null;
  private voiceReverbSend: GainNode | null = null;
  private glottalWave: PeriodicWave | null = null;
  private reverbNode: ConvolverNode | null = null;

  // Sample-rate-independent pre-synthesized raw channel data
  private preImpulseBase: [Float32Array, Float32Array] | null = null;
  private prePinkChannels: [Float32Array, Float32Array] | null = null;
  private chiffBuf: AudioBuffer | null = null;
  private flapBuf: AudioBuffer | null = null;
  private ruffleBuf: AudioBuffer | null = null;
  private shakeBuf: AudioBuffer | null = null;
  private crumbBiteBufs: AudioBuffer[] = [];
  private preloaded = false;

  // Procedural wind, spatial fountain/canal/canopy/tram/guitar streams & fall whistle nodes
  private windGainL: GainNode | null = null;
  private windGainR: GainNode | null = null;
  private windFilterL: BiquadFilterNode | null = null;
  private windFilterR: BiquadFilterNode | null = null;
  private windPanL: StereoPannerNode | null = null;
  private windPanR: StereoPannerNode | null = null;
  private updraftRushGain: GainNode | null = null;
  private updraftRushFilter: BiquadFilterNode | null = null;

  // Continuous 3D HRTF procedural fountain cascade & whitewater splash stream at (48, 5, 48)
  private fountainRoarGain: GainNode | null = null;
  private fountainSplashGain: GainNode | null = null;
  private fountainSplashFilter: BiquadFilterNode | null = null;

  // Continuous 3D HRTF procedural SW sunken canal flowing river stream along z = -54
  private canalFlowPanner: PannerNode | null = null;
  private canalFlowRoarGain: GainNode | null = null;
  private canalFlowSparkleGain: GainNode | null = null;
  private canalFlowSparkleFilter: BiquadFilterNode | null = null;

  // Continuous 3D HRTF rustling tree canopy streams
  private canopyGainNE: GainNode | null = null;
  private canopyFilterNE: BiquadFilterNode | null = null;
  private canopyGainSW: GainNode | null = null;
  private canopyFilterSW: BiquadFilterNode | null = null;

  // Continuous 3D HRTF conservatory window courtyard portal (audible while indoors)
  private windowPortalGain: GainNode | null = null;
  private windowPortalFilter: BiquadFilterNode | null = null;

  // Continuous 3D HRTF vintage streetcar rolling rail rumble, traction motor & overhead wire hiss
  private tramRailPanner: PannerNode | null = null;
  private tramRailGain: GainNode | null = null;
  private tramRailFilter: BiquadFilterNode | null = null;
  private tramMotorOsc: OscillatorNode | null = null;
  private tramMotorGain: GainNode | null = null;
  private tramWirePanner: PannerNode | null = null;
  private tramWireGain: GainNode | null = null;
  private tramWireFilter: BiquadFilterNode | null = null;
  private tramRailDistAccum = 0;

  // Continuous 3D HRTF street-busker acoustic guitar body chain at (33.5, 2.85, 39.5)
  private buskerGuitarPanner: PannerNode | null = null;
  private buskerDistanceGain: GainNode | null = null;
  private buskerBodyEq: BiquadFilterNode | null = null;
  private readonly guitarStringBufCache = new Map<string, AudioBuffer>();
  private buskerGrooveActive = false;
  private buskerNextStepTime = 0;
  private buskerPatternStep = 0;
  private buskerBarCount = 0;
  private buskerNotesPlayed = 0;

  private fallRushGain: GainNode | null = null;
  private fallRushFilter: BiquadFilterNode | null = null;
  private fallWhistleOsc: OscillatorNode | null = null;
  private fallWhistleGain: GainNode | null = null;

  private muted = false;
  private readonly paramTargetCache = new WeakMap<AudioParam, number>();

  private ambientClock = 0;
  private foleyTimer = 1.2;
  private ambientBirdTimer = 11.5;
  private lastAmbientChirpAt = -20;
  private lastPigeonCooAt = -25;
  private lastAmbientSpecies = -1;
  private ambientSpeciesBag: number[] = [];
  private clockTickTimer = 1.0;
  private clockTickPhase = 0;

  // Telemetry & 3D spatial listener state
  private airspeed = 0;
  private verticalVel = 0;
  private altitude = 12;
  private isFlying = false;
  private isHopping = false;
  private isIndoors = true;
  private windowOpenRatio = 0;
  private tramX = -34;
  private prevTramX = -34;
  private buskerProximity = 0;
  private canalProximity = 0.0;
  private fountainGeyserActive = false;
  private birdPos: Vec3Like = { x: -74.5, y: 34.5, z: 52.0 };

  private anyVignetteUnlocked = false;

  // Sparse Minimalist Mallet Sequencer State
  private modalIndex = 0;
  private chaosEnergy = 0;
  private actionEnergy = 0;
  private idleStillnessTimer = 0;
  private phraseCooldown = 4.5;
  private phraseHasFlourish = false;
  private activeMotifQueue: number[] = [];
  private activeMotifStep = 0;
  private activeMotifTotal = 0;
  private nextMotifStepTime = 0;
  private currentStepInterval = 0.24;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) {
          if (this.ctx.state === 'running') {
            void this.ctx.suspend();
          }
        } else if (!this.muted && this.ctx.state === 'suspended') {
          void this.ctx.resume();
        }
      });
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.muted ? 0.0001 : 0.88, now, 0.03);
      if (!this.muted && !document.hidden && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
    }
    return this.muted;
  }

  /**
   * Gently nudges action/flourish energy when props shatter or topple so the next minimalist
   * marimba phrase can bloom with a light 1-2 note grace flourish without overwhelming the score.
   */
  public addChaosImpulse(amount = 0.45): void {
    const clamped = Math.max(0, amount);
    this.chaosEnergy = Math.min(1.0, this.chaosEnergy + clamped);
    this.actionEnergy = Math.min(1.0, this.actionEnergy + clamped * 0.55);
    this.idleStillnessTimer = 0;
    if (this.chaosEnergy > 0.45 && this.phraseCooldown > 2.2) {
      this.phraseCooldown = 1.6 + Math.random() * 1.2;
    }
  }

  private disconnectOnEnded(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    src.onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          // Node already disconnected
        }
      }
    };
  }

  private setParamTargetIfDirty(
    param: AudioParam,
    target: number,
    now: number,
    timeConstant: number,
    epsilon: number
  ): void {
    if (!Number.isFinite(target)) return;
    const prev = this.paramTargetCache.get(param);
    if (
      prev !== undefined &&
      Math.abs(target - prev) < epsilon &&
      !(target <= 0.0002 && prev > 0.0002)
    ) {
      return;
    }
    this.paramTargetCache.set(param, target);
    param.setTargetAtTime(target, now, timeConstant);
  }

  private createHrtfLoopPanner(
    x: number,
    y: number,
    z: number,
    refDistance: number,
    rolloffFactor: number,
    destination: AudioNode
  ): PannerNode {
    const panner = this.ctx!.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = 210;
    panner.rolloffFactor = rolloffFactor;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
    panner.connect(destination);
    return panner;
  }

  private setPannerPosSmooth(panner: PannerNode | null, x: number, y: number, z: number, now: number): void {
    if (!panner) return;
    this.setParamTargetIfDirty(panner.positionX, x, now, 0.08, POS_EPSILON);
    this.setParamTargetIfDirty(panner.positionY, y, now, 0.08, POS_EPSILON);
    this.setParamTargetIfDirty(panner.positionZ, z, now, 0.08, POS_EPSILON);
  }

  private createSpatialOneShotOut(
    pos: Vec3Like | undefined,
    refDistance = 14,
    rolloffFactor = 1.05,
    routeThroughOutdoorFilter = false
  ): { dest: AudioNode; cleanup: AudioNode[] } {
    const targetBus =
      routeThroughOutdoorFilter && this.outdoorFilter ? this.outdoorFilter : this.sfxGain!;
    if (!pos || !this.ctx) {
      return { dest: targetBus, cleanup: [] };
    }
    const panner = this.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = 190;
    panner.rolloffFactor = rolloffFactor;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    panner.connect(targetBus);
    return { dest: panner, cleanup: [panner] };
  }

  /**
   * Tightly localized 3D HRTF human voice output with smooth distance air-absorption
   * and a hard audible radius cutoff so citizens are never heard across the city or indoors.
   */
  private createLocalizedVoiceOut(
    pos: Vec3Like | undefined,
    maxAudibleDist = 19.5,
    refDistance = 4.0
  ): { dest: AudioNode; cleanup: AudioNode[]; dist3D: number } | null {
    if (!this.ctx || !this.voiceGain) return null;
    if (this.isIndoors && this.windowOpenRatio < 0.25) {
      return null;
    }

    if (!pos) {
      return { dest: this.voiceGain, cleanup: [], dist3D: 0 };
    }

    const dist3D = Math.hypot(
      pos.x - this.birdPos.x,
      pos.y - this.birdPos.y,
      pos.z - this.birdPos.z
    );
    if (dist3D >= maxAudibleDist) {
      return null;
    }

    const span = Math.max(1.0, maxAudibleDist - refDistance);
    const over = Math.max(0.0, (dist3D - refDistance) / span);
    const fade =
      Math.pow(Math.max(0.0, 1.0 - over), 1.75) *
      (this.isIndoors ? 0.28 * this.windowOpenRatio : 1.0);
    if (fade < 0.012) {
      return null;
    }

    const airLp = this.ctx.createBiquadFilter();
    airLp.type = 'lowpass';
    airLp.frequency.value = Math.max(1250, 3850 - over * 2450);
    airLp.Q.value = 0.55;

    const distGain = this.ctx.createGain();
    distGain.gain.value = fade;

    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = maxAudibleDist + 6.0;
    panner.rolloffFactor = 1.18;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;

    airLp.connect(distGain);
    distGain.connect(panner);
    panner.connect(this.voiceGain);
    return { dest: airLp, cleanup: [airLp, distGain, panner], dist3D };
  }

  private syncSpatialListener(
    now: number,
    pos: Vec3Like,
    fwd?: Vec3Like,
    up?: Vec3Like
  ): void {
    if (!this.ctx) return;
    const listener = this.ctx.listener;
    if (listener.positionX) {
      this.setParamTargetIfDirty(listener.positionX, pos.x, now, 0.025, 0.04);
      this.setParamTargetIfDirty(listener.positionY, pos.y, now, 0.025, 0.04);
      this.setParamTargetIfDirty(listener.positionZ, pos.z, now, 0.025, 0.04);
      if (fwd && up) {
        this.setParamTargetIfDirty(listener.forwardX, fwd.x, now, 0.025, 0.02);
        this.setParamTargetIfDirty(listener.forwardY, fwd.y, now, 0.025, 0.02);
        this.setParamTargetIfDirty(listener.forwardZ, fwd.z, now, 0.025, 0.02);
        this.setParamTargetIfDirty(listener.upX, up.x, now, 0.025, 0.02);
        this.setParamTargetIfDirty(listener.upY, up.y, now, 0.025, 0.02);
        this.setParamTargetIfDirty(listener.upZ, up.z, now, 0.025, 0.02);
      }
    } else {
      listener.setPosition(pos.x, pos.y, pos.z);
      if (fwd && up) {
        listener.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
    }
  }

  /**
   * Pre-computes sample-rate-independent raw Float32Array noise/impulse streams (covering up to 96 kHz
   * hardware output rates) and pre-fetches ambient MP3 ArrayBuffers during loading so unlock() matches
   * any hardware AudioContext.sampleRate (24kHz, 44.1kHz, 48kHz, 96kHz) without a ConvolverNode mismatch.
   */
  public async preload(): Promise<void> {
    if (this.preloaded) return;
    this.preloaded = true;
    const maxRate = 96000;

    // 1. Pre-generate 1-pole filtered stereo impulse base (up to 2.2s @ 96kHz)
    const impMaxLen = Math.ceil(maxRate * 2.2);
    const impL = new Float32Array(impMaxLen);
    const impR = new Float32Array(impMaxLen);
    for (let ch = 0; ch < 2; ch++) {
      const dst = ch === 0 ? impL : impR;
      let prev = 0;
      for (let i = 0; i < impMaxLen; i++) {
        const white = Math.random() * 2 - 1;
        prev = prev * 0.62 + white * 0.38;
        dst[i] = prev;
      }
    }
    this.preImpulseBase = [impL, impR];
    await new Promise<void>((r) => window.setTimeout(r, 0));

    // 2. Pre-generate 5s stereo Kellet pink noise (up to 5s @ 96kHz)
    const pinkMaxLen = maxRate * 5;
    const pinkL = new Float32Array(pinkMaxLen);
    const pinkR = new Float32Array(pinkMaxLen);
    for (let ch = 0; ch < 2; ch++) {
      const out = ch === 0 ? pinkL : pinkR;
      this.fillPinkNoiseChannel(out);
    }
    this.prePinkChannels = [pinkL, pinkR];
    await new Promise<void>((r) => window.setTimeout(r, 0));
  }

  public unlock(): void {
    if (this.ctx) {
      if (!this.muted && !document.hidden && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0.0001 : 0.88;
      this.masterGain.connect(this.ctx.destination);

      this.reverbNode = this.createCourtyardImpulse(2.2, 2.5);
      const reverbWet = this.ctx.createGain();
      reverbWet.gain.value = 0.30;
      this.reverbNode.connect(reverbWet);
      reverbWet.connect(this.masterGain);

      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.gain.value = 1.05;
      this.ambienceGain.connect(this.masterGain);

      // Master outdoor lowpass filter (muffles outdoor city while inside the 2nd-story Attic Studio,
      // opening smoothly as the East French window swings wide)
      this.outdoorFilter = this.ctx.createBiquadFilter();
      this.outdoorFilter.type = 'lowpass';
      this.outdoorFilter.frequency.value = 980;
      this.outdoorFilter.Q.value = 0.55;
      this.outdoorFilter.connect(this.ambienceGain);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.56;
      this.musicGain.connect(this.masterGain);
      this.musicGain.connect(this.reverbNode);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.82;
      this.sfxGain.connect(this.masterGain);
      this.sfxGain.connect(this.reverbNode);

      // Dedicated dry human-vocal bus (~99% less reverb than sfxGain + indoor occlusion lowpass)
      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.value = 0.88;
      this.voiceIndoorFilter = this.ctx.createBiquadFilter();
      this.voiceIndoorFilter.type = 'lowpass';
      this.voiceIndoorFilter.frequency.value = 620;
      this.voiceIndoorFilter.Q.value = 0.55;
      this.voiceGain.connect(this.voiceIndoorFilter);
      this.voiceIndoorFilter.connect(this.masterGain);
      this.voiceReverbSend = this.ctx.createGain();
      this.voiceReverbSend.gain.value = 0.01;
      this.voiceIndoorFilter.connect(this.voiceReverbSend);
      this.voiceReverbSend.connect(this.reverbNode);

      this.initNoiseBuffers();
      this.initContinuousAmbiance();

      if (document.hidden && this.ctx.state === 'running') {
        void this.ctx.suspend();
      } else if (!this.muted && !document.hidden && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
    } catch (err) {
      console.error('AcousticSoundtrack initialization failed:', err);
    }
  }

  private initNoiseBuffers(): void {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;

    const chiffLen = Math.max(16, Math.floor(rate * 0.011));
    this.chiffBuf = ctx.createBuffer(1, chiffLen, rate);
    const chiffData = this.chiffBuf.getChannelData(0);
    for (let i = 0; i < chiffLen; i++) {
      chiffData[i] = (Math.random() * 2 - 1) * (1 - i / chiffLen);
    }

    const flapLen = Math.max(32, Math.floor(rate * 0.052));
    this.flapBuf = ctx.createBuffer(1, flapLen, rate);
    const flapData = this.flapBuf.getChannelData(0);
    for (let i = 0; i < flapLen; i++) {
      flapData[i] = (Math.random() * 2 - 1) * Math.sin((i / flapLen) * Math.PI);
    }

    const ruffleLen = Math.max(64, Math.floor(rate * 0.11));
    this.ruffleBuf = ctx.createBuffer(1, ruffleLen, rate);
    const ruffleData = this.ruffleBuf.getChannelData(0);
    for (let i = 0; i < ruffleLen; i++) {
      const env = Math.sin((i / ruffleLen) * Math.PI) * (0.6 + 0.4 * Math.sin(i * 0.09));
      ruffleData[i] = (Math.random() * 2 - 1) * env;
    }

    const shakeLen = Math.max(32, Math.floor(rate * 0.06));
    this.shakeBuf = ctx.createBuffer(1, shakeLen, rate);
    const shakeData = this.shakeBuf.getChannelData(0);
    for (let s = 0; s < shakeLen; s++) {
      shakeData[s] = (Math.random() * 2 - 1) * Math.sin((s / shakeLen) * Math.PI);
    }

    // Rosenberg natural glottal-pulse PeriodicWave (~-12 dB/oct smooth vocal-fold harmonics, zero sawtooth buzz)
    const nGlottal = 256;
    const nHarmonics = 28;
    const pulse = new Float32Array(nGlottal);
    const tp = 0.44;
    const tn = 0.2;
    for (let i = 0; i < nGlottal; i++) {
      const u = i / nGlottal;
      if (u < tp) {
        pulse[i] = 0.5 * (1.0 - Math.cos((Math.PI * u) / tp));
      } else if (u < tp + tn) {
        pulse[i] = Math.cos((0.5 * Math.PI * (u - tp)) / tn);
      } else {
        pulse[i] = 0.0;
      }
    }
    const gReal = new Float32Array(nHarmonics + 1);
    const gImag = new Float32Array(nHarmonics + 1);
    for (let k = 1; k <= nHarmonics; k++) {
      let sumCos = 0;
      let sumSin = 0;
      const twoPiK = (2.0 * Math.PI * k) / nGlottal;
      for (let i = 0; i < nGlottal; i++) {
        const ang = twoPiK * i;
        sumCos += pulse[i] * Math.cos(ang);
        sumSin += pulse[i] * Math.sin(ang);
      }
      const velvetTilt = 1.0 / (1.0 + 0.045 * k * k);
      gReal[k] = (2.0 * sumCos * velvetTilt) / nGlottal;
      gImag[k] = (2.0 * sumSin * velvetTilt) / nGlottal;
    }
    this.glottalWave = ctx.createPeriodicWave(gReal, gImag, { disableNormalization: false });

    this.crumbBiteBufs = CRUMB_BITE_SPECS.map((spec) => {
      const len = Math.max(32, Math.floor(rate * spec.dur));
      const buf = ctx.createBuffer(1, len, rate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const u = i / len;
        const env = Math.pow(1 - u, 1.35) * (0.45 + 0.55 * Math.abs(Math.sin(i * 0.37)));
        const r = Math.random() * 2 - 1;
        const crackle = Math.sign(r) * Math.pow(Math.abs(r), 1.85);
        d[i] = crackle * env;
      }
      return buf;
    });
  }

  private createCourtyardImpulse(durationSec: number, decay: number): ConvolverNode {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * durationSec));
    const impulse = ctx.createBuffer(2, length, rate);
    const preBase = this.preImpulseBase;
    const invLen = 1 / length;

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      if (preBase && preBase[ch].length >= length && decay === 2.5) {
        const src = preBase[ch];
        for (let i = 0; i < length; i++) {
          const u = 1 - i * invLen;
          data[i] = src[i] * u * u * Math.sqrt(u) * 0.45;
        }
      } else {
        let prev = 0;
        for (let i = 0; i < length; i++) {
          const t = i * invLen;
          const white = Math.random() * 2 - 1;
          prev = prev * 0.62 + white * 0.38;
          data[i] = prev * Math.pow(1 - t, decay) * 0.45;
        }
      }
    }
    this.preImpulseBase = null;

    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    return convolver;
  }

  private fillPinkNoiseChannel(out: Float32Array): void {
    const len = out.length;
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
      b6 = white * 0.115926;
    }
  }

  private initContinuousAmbiance(): void {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * 5));
    const pinkBuf = ctx.createBuffer(2, len, rate);
    const prePink = this.prePinkChannels;
    for (let ch = 0; ch < 2; ch++) {
      if (prePink && prePink[ch].length >= len) {
        pinkBuf.getChannelData(ch).set(prePink[ch].subarray(0, len));
      } else {
        this.fillPinkNoiseChannel(pinkBuf.getChannelData(ch));
      }
    }
    this.prePinkChannels = null;

    // 1A. Left Stereo Breeze (with dynamic carving-turn panning)
    const srcL = ctx.createBufferSource();
    srcL.buffer = pinkBuf;
    srcL.loop = true;
    this.windFilterL = ctx.createBiquadFilter();
    this.windFilterL.type = 'bandpass';
    this.windFilterL.frequency.value = 285;
    this.windFilterL.Q.value = 0.78;
    this.windPanL = ctx.createStereoPanner();
    this.windPanL.pan.value = -0.52;
    this.windGainL = ctx.createGain();
    this.windGainL.gain.value = 0.026;
    srcL.connect(this.windFilterL);
    this.windFilterL.connect(this.windPanL);
    this.windPanL.connect(this.windGainL);
    this.windGainL.connect(this.outdoorFilter!);
    srcL.start();

    // 1B. Right Stereo Breeze (with dynamic carving-turn panning)
    const srcR = ctx.createBufferSource();
    srcR.buffer = pinkBuf;
    srcR.loop = true;
    this.windFilterR = ctx.createBiquadFilter();
    this.windFilterR.type = 'bandpass';
    this.windFilterR.frequency.value = 370;
    this.windFilterR.Q.value = 0.85;
    this.windPanR = ctx.createStereoPanner();
    this.windPanR.pan.value = 0.52;
    this.windGainR = ctx.createGain();
    this.windGainR.gain.value = 0.026;
    srcR.connect(this.windFilterR);
    this.windFilterR.connect(this.windPanR);
    this.windPanR.connect(this.windGainR);
    this.windGainR.connect(this.outdoorFilter!);
    srcR.start(0, 2.3);

    // 1C. Warm Rising Thermal / Updraft Column Rush
    const updraftSrc = ctx.createBufferSource();
    updraftSrc.buffer = pinkBuf;
    updraftSrc.loop = true;
    this.updraftRushFilter = ctx.createBiquadFilter();
    this.updraftRushFilter.type = 'bandpass';
    this.updraftRushFilter.frequency.value = 460;
    this.updraftRushFilter.Q.value = 1.05;
    this.updraftRushGain = ctx.createGain();
    this.updraftRushGain.gain.value = 0.0001;
    updraftSrc.connect(this.updraftRushFilter);
    this.updraftRushFilter.connect(this.updraftRushGain);
    this.updraftRushGain.connect(this.outdoorFilter!);
    updraftSrc.start(0, 1.45);

    // 2. Warm Courtyard / Room Air Bed
    const citySrc = ctx.createBufferSource();
    citySrc.buffer = pinkBuf;
    citySrc.loop = true;
    const cityLp = ctx.createBiquadFilter();
    cityLp.type = 'lowpass';
    cityLp.frequency.value = 195;
    const cityHumGain = ctx.createGain();
    cityHumGain.gain.value = 0.19;
    citySrc.connect(cityLp);
    cityLp.connect(cityHumGain);
    cityHumGain.connect(this.ambienceGain!);
    citySrc.start(0, 1.1);

    // 3. 3D Spatialized Fountain Cascade & Whitewater Splash Stream at (48, 5.2, 48)
    const fountainPanner = this.createHrtfLoopPanner(48.0, 5.2, 48.0, 14.0, 1.08, this.outdoorFilter!);
    const fRoarSrc = ctx.createBufferSource();
    fRoarSrc.buffer = pinkBuf;
    fRoarSrc.loop = true;
    const fRoarBp = ctx.createBiquadFilter();
    fRoarBp.type = 'bandpass';
    fRoarBp.frequency.value = 480;
    fRoarBp.Q.value = 0.72;
    this.fountainRoarGain = ctx.createGain();
    this.fountainRoarGain.gain.value = 0.24;
    fRoarSrc.connect(fRoarBp);
    fRoarBp.connect(this.fountainRoarGain);
    this.fountainRoarGain.connect(fountainPanner);
    fRoarSrc.start(0, 0.45);

    const fSplashSrc = ctx.createBufferSource();
    fSplashSrc.buffer = pinkBuf;
    fSplashSrc.loop = true;
    this.fountainSplashFilter = ctx.createBiquadFilter();
    this.fountainSplashFilter.type = 'bandpass';
    this.fountainSplashFilter.frequency.value = 2350;
    this.fountainSplashFilter.Q.value = 1.05;
    this.fountainSplashGain = ctx.createGain();
    this.fountainSplashGain.gain.value = 0.14;
    fSplashSrc.connect(this.fountainSplashFilter);
    this.fountainSplashFilter.connect(this.fountainSplashGain);
    this.fountainSplashGain.connect(fountainPanner);
    fSplashSrc.start(0, 3.15);

    // 3B. 3D Spatialized SW Sunken Canal Flowing River Stream along z = -54
    this.canalFlowPanner = this.createHrtfLoopPanner(-68.0, -0.5, -54.0, 14.0, 1.05, this.outdoorFilter!);
    const cFlowSrc = ctx.createBufferSource();
    cFlowSrc.buffer = pinkBuf;
    cFlowSrc.loop = true;
    const cFlowBp = ctx.createBiquadFilter();
    cFlowBp.type = 'bandpass';
    cFlowBp.frequency.value = 435;
    cFlowBp.Q.value = 0.78;
    this.canalFlowRoarGain = ctx.createGain();
    this.canalFlowRoarGain.gain.value = 0.16;
    cFlowSrc.connect(cFlowBp);
    cFlowBp.connect(this.canalFlowRoarGain);
    this.canalFlowRoarGain.connect(this.canalFlowPanner);
    cFlowSrc.start(0, 1.9);

    const cSparkleSrc = ctx.createBufferSource();
    cSparkleSrc.buffer = pinkBuf;
    cSparkleSrc.loop = true;
    this.canalFlowSparkleFilter = ctx.createBiquadFilter();
    this.canalFlowSparkleFilter.type = 'bandpass';
    this.canalFlowSparkleFilter.frequency.value = 1920;
    this.canalFlowSparkleFilter.Q.value = 1.15;
    this.canalFlowSparkleGain = ctx.createGain();
    this.canalFlowSparkleGain.gain.value = 0.095;
    cSparkleSrc.connect(this.canalFlowSparkleFilter);
    this.canalFlowSparkleFilter.connect(this.canalFlowSparkleGain);
    this.canalFlowSparkleGain.connect(this.canalFlowPanner);
    cSparkleSrc.start(0, 4.35);

    // 4. 3D Spatialized Rustling Tree Canopy Streams (NE Botanical Park + Courtyard Boulevards)
    const canopyPannerNE = this.createHrtfLoopPanner(38.0, 16.0, 40.0, 22.0, 0.85, this.outdoorFilter!);
    const cSrcNE = ctx.createBufferSource();
    cSrcNE.buffer = pinkBuf;
    cSrcNE.loop = true;
    this.canopyFilterNE = ctx.createBiquadFilter();
    this.canopyFilterNE.type = 'bandpass';
    this.canopyFilterNE.frequency.value = 1480;
    this.canopyFilterNE.Q.value = 1.15;
    this.canopyGainNE = ctx.createGain();
    this.canopyGainNE.gain.value = 0.11;
    cSrcNE.connect(this.canopyFilterNE);
    this.canopyFilterNE.connect(this.canopyGainNE);
    this.canopyGainNE.connect(canopyPannerNE);
    cSrcNE.start(0, 1.65);

    const canopyPannerSW = this.createHrtfLoopPanner(-24.0, 15.0, -28.0, 24.0, 0.85, this.outdoorFilter!);
    const cSrcSW = ctx.createBufferSource();
    cSrcSW.buffer = pinkBuf;
    cSrcSW.loop = true;
    this.canopyFilterSW = ctx.createBiquadFilter();
    this.canopyFilterSW.type = 'bandpass';
    this.canopyFilterSW.frequency.value = 1320;
    this.canopyFilterSW.Q.value = 1.1;
    this.canopyGainSW = ctx.createGain();
    this.canopyGainSW.gain.value = 0.095;
    cSrcSW.connect(this.canopyFilterSW);
    this.canopyFilterSW.connect(this.canopyGainSW);
    this.canopyGainSW.connect(canopyPannerSW);
    cSrcSW.start(0, 3.85);

    // 5. 3D Spatialized Conservatory East Window Portal at (-39.4, 37.5, 52.0)
    // Gives directional outdoor morning breeze & courtyard presence while inside the Attic Atelier
    const winPanner = this.createHrtfLoopPanner(-39.4, 37.5, 52.0, 9.5, 1.1, this.ambienceGain!);
    const winSrc = ctx.createBufferSource();
    winSrc.buffer = pinkBuf;
    winSrc.loop = true;
    this.windowPortalFilter = ctx.createBiquadFilter();
    this.windowPortalFilter.type = 'bandpass';
    this.windowPortalFilter.frequency.value = 780;
    this.windowPortalFilter.Q.value = 0.9;
    this.windowPortalGain = ctx.createGain();
    this.windowPortalGain.gain.value = 0.09;
    winSrc.connect(this.windowPortalFilter);
    this.windowPortalFilter.connect(this.windowPortalGain);
    this.windowPortalGain.connect(winPanner);
    winSrc.start(0, 2.8);

    // 6. 3D Spatialized Vintage Streetcar Rolling Rail Rumble, Traction Motor & Pantograph Hiss along z = 0
    this.tramRailPanner = this.createHrtfLoopPanner(-34.0, 1.4, 0.0, 13.0, 1.15, this.outdoorFilter!);
    const tramSrc = ctx.createBufferSource();
    tramSrc.buffer = pinkBuf;
    tramSrc.loop = true;
    this.tramRailFilter = ctx.createBiquadFilter();
    this.tramRailFilter.type = 'bandpass';
    this.tramRailFilter.frequency.value = 142;
    this.tramRailFilter.Q.value = 1.95;
    this.tramRailGain = ctx.createGain();
    this.tramRailGain.gain.value = 0.0001;
    tramSrc.connect(this.tramRailFilter);
    this.tramRailFilter.connect(this.tramRailGain);
    this.tramRailGain.connect(this.tramRailPanner);
    tramSrc.start(0, 4.1);

    // Electric traction motor harmonic hum
    this.tramMotorOsc = ctx.createOscillator();
    this.tramMotorOsc.type = 'triangle';
    this.tramMotorOsc.frequency.value = 92;
    const motorLp = ctx.createBiquadFilter();
    motorLp.type = 'lowpass';
    motorLp.frequency.value = 540;
    this.tramMotorGain = ctx.createGain();
    this.tramMotorGain.gain.value = 0.0001;
    this.tramMotorOsc.connect(motorLp);
    motorLp.connect(this.tramMotorGain);
    this.tramMotorGain.connect(this.tramRailPanner);
    this.tramMotorOsc.start();

    // Overhead trolley pantograph wire contact hiss at y = 23.2
    this.tramWirePanner = this.createHrtfLoopPanner(-34.0, 23.2, 0.0, 11.0, 1.2, this.outdoorFilter!);
    const wireSrc = ctx.createBufferSource();
    wireSrc.buffer = pinkBuf;
    wireSrc.loop = true;
    this.tramWireFilter = ctx.createBiquadFilter();
    this.tramWireFilter.type = 'bandpass';
    this.tramWireFilter.frequency.value = 3850;
    this.tramWireFilter.Q.value = 2.1;
    this.tramWireGain = ctx.createGain();
    this.tramWireGain.gain.value = 0.0001;
    wireSrc.connect(this.tramWireFilter);
    this.tramWireFilter.connect(this.tramWireGain);
    this.tramWireGain.connect(this.tramWirePanner);
    wireSrc.start(0, 0.92);

    // 6B. Tightly Localized 3D Acoustic Guitarist Luthiery Body Chain at (33.5, 2.85, 39.5)
    this.buskerGuitarPanner = this.createHrtfLoopPanner(33.5, 2.85, 39.5, 4.0, 2.65, this.outdoorFilter!);
    this.buskerDistanceGain = ctx.createGain();
    this.buskerDistanceGain.gain.value = 0.0001;
    // Stage 1: Helmholtz Soundhole Air Cavity Resonance (~98 Hz)
    this.buskerBodyEq = ctx.createBiquadFilter();
    this.buskerBodyEq.type = 'peaking';
    this.buskerBodyEq.frequency.value = 98;
    this.buskerBodyEq.Q.value = 2.4;
    this.buskerBodyEq.gain.value = 5.4;
    // Stage 2: Spruce Soundboard Main Plate Mode (~206 Hz)
    const buskerSpruceTop = ctx.createBiquadFilter();
    buskerSpruceTop.type = 'peaking';
    buskerSpruceTop.frequency.value = 206;
    buskerSpruceTop.Q.value = 1.65;
    buskerSpruceTop.gain.value = 4.8;
    // Stage 3: Rosewood Upper-Bout Warmth (~430 Hz) + Natural Air Absorption Lowpass
    const buskerRosewood = ctx.createBiquadFilter();
    buskerRosewood.type = 'peaking';
    buskerRosewood.frequency.value = 430;
    buskerRosewood.Q.value = 1.4;
    buskerRosewood.gain.value = 2.8;
    const buskerWarmLp = ctx.createBiquadFilter();
    buskerWarmLp.type = 'lowpass';
    buskerWarmLp.frequency.value = 4950;
    this.buskerBodyEq.connect(buskerSpruceTop);
    buskerSpruceTop.connect(buskerRosewood);
    buskerRosewood.connect(buskerWarmLp);
    buskerWarmLp.connect(this.buskerDistanceGain);
    this.buskerDistanceGain.connect(this.buskerGuitarPanner);

    // 7. Continuous Fall / Dive Air-Rush & Soft Whistle
    const fallSrc = ctx.createBufferSource();
    fallSrc.buffer = pinkBuf;
    fallSrc.loop = true;
    this.fallRushFilter = ctx.createBiquadFilter();
    this.fallRushFilter.type = 'bandpass';
    this.fallRushFilter.frequency.value = 900;
    this.fallRushFilter.Q.value = 1.4;
    this.fallRushGain = ctx.createGain();
    this.fallRushGain.gain.value = 0.0001;
    fallSrc.connect(this.fallRushFilter);
    this.fallRushFilter.connect(this.fallRushGain);
    this.fallRushGain.connect(this.sfxGain!);
    fallSrc.start(0, 0.7);

    this.fallWhistleOsc = ctx.createOscillator();
    this.fallWhistleOsc.type = 'sine';
    this.fallWhistleOsc.frequency.value = 680;
    this.fallWhistleGain = ctx.createGain();
    this.fallWhistleGain.gain.value = 0.0001;
    this.fallWhistleOsc.connect(this.fallWhistleGain);
    this.fallWhistleGain.connect(this.sfxGain!);
    this.fallWhistleOsc.start();
  }

  public setVignetteLayer(index: number): void {
    if (index >= 0 && index < 5) {
      this.anyVignetteUnlocked = true;
      if (index === 1) {
        this.fountainGeyserActive = true;
      }
    }
  }

  public getBuskerNotesPlayed(): number {
    return this.buskerNotesPlayed;
  }

  public getDiagnostics(): {
    windGainL: number;
    windGainR: number;
    fallRushGain: number;
    buskerDistanceGain: number;
    buskerRefDistance: number;
    buskerRolloff: number;
    guitarCachedStrings: number;
  } {
    return {
      windGainL: this.windGainL ? (this.paramTargetCache.get(this.windGainL.gain) ?? this.windGainL.gain.value) : 0,
      windGainR: this.windGainR ? (this.paramTargetCache.get(this.windGainR.gain) ?? this.windGainR.gain.value) : 0,
      fallRushGain: this.fallRushGain ? (this.paramTargetCache.get(this.fallRushGain.gain) ?? this.fallRushGain.gain.value) : 0,
      buskerDistanceGain: this.buskerDistanceGain
        ? (this.paramTargetCache.get(this.buskerDistanceGain.gain) ?? this.buskerDistanceGain.gain.value)
        : 0,
      buskerRefDistance: this.buskerGuitarPanner?.refDistance ?? 0,
      buskerRolloff: this.buskerGuitarPanner?.rolloffFactor ?? 0,
      guitarCachedStrings: this.guitarStringBufCache.size,
    };
  }

  public updateTelemetry(params: {
    dt: number;
    isFlying: boolean;
    isHopping: boolean;
    airspeed: number;
    verticalVel?: number;
    altitude: number;
    buskerProximity: number;
    buskerGroove?: boolean;
    bankAngle?: number;
    thermalLift?: number;
    isIndoors?: boolean;
    windowOpenRatio?: number;
    tramX?: number;
    birdPos?: Vec3Like;
    camPos?: Vec3Like;
    camFwd?: Vec3Like;
    camUp?: Vec3Like;
  }): void {
    const dt = Math.min(0.1, Math.max(0.001, params.dt));
    this.isFlying = params.isFlying;
    this.isHopping = params.isHopping;
    this.airspeed = params.airspeed;
    this.verticalVel = params.verticalVel ?? 0;
    this.altitude = params.altitude;
    this.buskerProximity = params.buskerProximity;
    this.buskerGrooveActive = Boolean(params.buskerGroove);
    const bankAngle = params.bankAngle ?? 0;
    const thermalLift = Math.max(0, params.thermalLift ?? 0);
    this.isIndoors = params.isIndoors ?? false;
    this.windowOpenRatio = Math.max(0, Math.min(1, params.windowOpenRatio ?? (this.isIndoors ? 0 : 1)));

    if (params.tramX !== undefined) {
      this.prevTramX = this.tramX;
      this.tramX = params.tramX;
    }

    if (params.birdPos) {
      this.birdPos.x = params.birdPos.x;
      this.birdPos.y = params.birdPos.y;
      this.birdPos.z = params.birdPos.z;
    }

    const bx = this.birdPos.x;
    const bz = this.birdPos.z;
    // Sunken Canal & Waterfront Boardwalk (SW Block)
    const nearestCanalX = Math.max(-124.0, Math.min(-22.0, bx));

    if (params.birdPos) {
      const distCanal = Math.hypot(bx - nearestCanalX, bz + 54.0);
      this.canalProximity = Math.max(0.0, 1.0 - distCanal / 68.0);
    }

    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.ambientClock += dt;

    // --- 0. Sync 3D Spatial AudioListener & Dynamic Emitter Anchors ---
    const listenerOrigin = params.camPos ?? this.birdPos;
    this.syncSpatialListener(now, listenerOrigin, params.camFwd, params.camUp);

    // Move dynamic line 3D HRTF canal emitter smoothly toward nearest active point
    this.setPannerPosSmooth(this.canalFlowPanner, nearestCanalX, -0.5, -54.0, now);

    // --- 1. Indoor vs Outdoor Filter + 3D Procedural Stream Mixing ---
    if (this.outdoorFilter) {
      const indoorCutoff = 980 + this.windowOpenRatio * 5800;
      const targetCutoff = this.isIndoors ? indoorCutoff : 17500;
      this.setParamTargetIfDirty(this.outdoorFilter.frequency, targetCutoff, now, 0.22, FREQ_EPSILON);
    }
    if (this.voiceIndoorFilter && this.voiceGain) {
      const targetVoiceCutoff = this.isIndoors ? 520 + this.windowOpenRatio * 950 : 4600;
      const targetVoiceBusGain = this.isIndoors
        ? Math.max(0.0001, this.windowOpenRatio * 0.22)
        : 0.88;
      this.setParamTargetIfDirty(
        this.voiceIndoorFilter.frequency,
        targetVoiceCutoff,
        now,
        0.18,
        FREQ_EPSILON
      );
      this.setParamTargetIfDirty(this.voiceGain.gain, targetVoiceBusGain, now, 0.16, GAIN_EPSILON);
    }

    const indoorAtten = this.isIndoors ? 0.46 + this.windowOpenRatio * 0.36 : 1.0;

    // 3D Procedural Fountain Cascade & Bubbling Splash Modulation
    if (this.fountainRoarGain && this.fountainSplashGain && this.fountainSplashFilter) {
      const fSwell = 0.85 + 0.15 * Math.sin(this.ambientClock * 1.9) * Math.cos(this.ambientClock * 0.73);
      const geyserBoost = this.fountainGeyserActive ? 1.45 : 1.0;
      this.setParamTargetIfDirty(
        this.fountainRoarGain.gain,
        0.28 * fSwell * geyserBoost * indoorAtten,
        now,
        0.18,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.fountainSplashGain.gain,
        0.16 * (0.8 + 0.2 * Math.cos(this.ambientClock * 2.7)) * geyserBoost * indoorAtten,
        now,
        0.16,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.fountainSplashFilter.frequency,
        2150 + 480 * Math.sin(this.ambientClock * 1.45),
        now,
        0.2,
        FREQ_EPSILON
      );
    }

    // 3D Procedural SW Sunken Canal Flowing River Stream Modulation
    if (this.canalFlowRoarGain && this.canalFlowSparkleGain && this.canalFlowSparkleFilter) {
      const cSwell = 0.84 + 0.16 * Math.sin(this.ambientClock * 1.55 + 0.8);
      const bridgeEddy =
        Math.abs(nearestCanalX + 44.0) < 9.0 || Math.abs(nearestCanalX + 96.0) < 9.0 ? 1.24 : 1.0;
      this.setParamTargetIfDirty(
        this.canalFlowRoarGain.gain,
        (0.16 + this.canalProximity * 0.18) * cSwell * bridgeEddy * indoorAtten,
        now,
        0.2,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.canalFlowSparkleGain.gain,
        (0.085 + this.canalProximity * 0.12) * (0.82 + 0.18 * Math.cos(this.ambientClock * 2.35)) * bridgeEddy * indoorAtten,
        now,
        0.18,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.canalFlowSparkleFilter.frequency,
        1780 + 420 * Math.sin(this.ambientClock * 1.25),
        now,
        0.22,
        FREQ_EPSILON
      );
    }

    // 3D Rustling Tree Canopy Modulation
    const gustL =
      0.5 + 0.5 * Math.sin(this.ambientClock * 0.68) * Math.cos(this.ambientClock * 0.29);
    const gustR =
      0.5 + 0.5 * Math.cos(this.ambientClock * 0.53 + 1.2) * Math.sin(this.ambientClock * 0.23);

    if (this.canopyGainNE && this.canopyFilterNE && this.canopyGainSW && this.canopyFilterSW) {
      this.setParamTargetIfDirty(
        this.canopyGainNE.gain,
        (0.08 + gustL * 0.14) * indoorAtten,
        now,
        0.22,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.canopyFilterNE.frequency,
        1250 + gustL * 680,
        now,
        0.25,
        FREQ_EPSILON
      );
      this.setParamTargetIfDirty(
        this.canopyGainSW.gain,
        (0.07 + gustR * 0.12) * indoorAtten,
        now,
        0.22,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.canopyFilterSW.frequency,
        1150 + gustR * 620,
        now,
        0.25,
        FREQ_EPSILON
      );
    }

    // 3D Conservatory East Window Portal (directional draft & courtyard air while indoors)
    if (this.windowPortalGain && this.windowPortalFilter) {
      const winGain = this.isIndoors ? 0.085 + this.windowOpenRatio * 0.16 : 0.02;
      const winFreq = 720 + this.windowOpenRatio * 1450 + gustL * 260;
      this.setParamTargetIfDirty(this.windowPortalGain.gain, winGain, now, 0.2, GAIN_EPSILON);
      this.setParamTargetIfDirty(this.windowPortalFilter.frequency, winFreq, now, 0.2, FREQ_EPSILON);
    }

    // 3D Vintage Tram Rolling Rumble, Traction Motor Whine, Pantograph Hiss & Rail-Joint Clacks
    if (this.tramRailPanner && this.tramRailGain && this.tramRailFilter) {
      const dTram = Math.abs(this.tramX - this.prevTramX);
      const tramSpeed = dTram < 12.0 ? dTram / dt : 0;
      const speedNorm = Math.min(1.0, tramSpeed / 10.5);
      this.setPannerPosSmooth(this.tramRailPanner, this.tramX, 1.4, 0.0, now);
      this.setParamTargetIfDirty(
        this.tramRailGain.gain,
        (this.isIndoors ? 0.035 : 0.18) * speedNorm,
        now,
        0.16,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.tramRailFilter.frequency,
        118 + speedNorm * 82,
        now,
        0.18,
        FREQ_EPSILON
      );

      if (this.tramMotorOsc && this.tramMotorGain) {
        this.setParamTargetIfDirty(
          this.tramMotorGain.gain,
          (this.isIndoors ? 0.008 : 0.048) * Math.pow(speedNorm, 0.8),
          now,
          0.14,
          GAIN_EPSILON
        );
        this.setParamTargetIfDirty(
          this.tramMotorOsc.frequency,
          82 + speedNorm * 134,
          now,
          0.14,
          FREQ_EPSILON
        );
      }

      if (this.tramWirePanner && this.tramWireGain && this.tramWireFilter) {
        this.setPannerPosSmooth(this.tramWirePanner, this.tramX, 23.2, 0.0, now);
        this.setParamTargetIfDirty(
          this.tramWireGain.gain,
          (this.isIndoors ? 0.004 : 0.034) * speedNorm,
          now,
          0.16,
          GAIN_EPSILON
        );
        this.setParamTargetIfDirty(
          this.tramWireFilter.frequency,
          3400 + speedNorm * 1150,
          now,
          0.2,
          FREQ_EPSILON
        );
      }

      if (dTram > 0.0005 && dTram < 12.0) {
        this.tramRailDistAccum += dTram;
        if (this.tramRailDistAccum >= 9.0) {
          this.tramRailDistAccum -= 9.0;
          if (!this.isIndoors && Math.hypot(bx - this.tramX, bz) < 76.0 && speedNorm > 0.12) {
            this.playTramRailJointClack(this.tramX, speedNorm);
          }
        }
      }
    }

    // 3D Spatialized Atelier Wall Clock (Indoors) & SE Clocktower Mechanical Escapement (Outdoors)
    this.clockTickTimer -= dt;
    if (this.clockTickTimer <= 0) {
      this.clockTickTimer = 1.0;
      this.clockTickPhase = 1 - this.clockTickPhase;
      if (this.isIndoors) {
        this.playIndoorClockTick(this.clockTickPhase === 0);
      } else if (Math.hypot(bx - 96.0, bz + 96.0) < 68.0) {
        this.playTowerEscapementTick(this.clockTickPhase === 0);
      }
    }

    // 3D Street-Busker Acoustic Guitar Continuous Courtyard Performance at (33.5, 2.85, 39.5)
    // Tightly localized in 3D space around the busker's park corner (~34 SU radius from the bird)
    const distBusker3D = Math.hypot(
      this.birdPos.x - 33.5,
      (this.birdPos.y - 2.85) * 0.85,
      this.birdPos.z - 39.5
    );
    const buskerAudible = !this.isIndoors && distBusker3D < 34.5;
    if (this.buskerDistanceGain) {
      const localEnv = !buskerAudible
        ? 0.0001
        : distBusker3D <= 5.2
          ? 1.0
          : Math.max(0.0001, Math.pow(Math.max(0, 1.0 - (distBusker3D - 5.2) / 28.8), 2.2));
      this.setParamTargetIfDirty(this.buskerDistanceGain.gain, localEnv, now, 0.075, GAIN_EPSILON);
    }
    if (buskerAudible) {
      if (this.buskerNextStepTime < now - 0.12) {
        this.buskerNextStepTime = now + 0.02;
      }
      const lookahead = now + MOTIF_LOOKAHEAD_SEC;
      while (this.buskerNextStepTime <= lookahead) {
        this.stepBuskerGuitarPerformance(Math.max(now, this.buskerNextStepTime));
      }
    } else {
      this.buskerNextStepTime = now + 0.03;
    }

    // Dynamic Stereo Breeze + Subtle Feather-Light Flight Air + Thermal Updraft Whisper
    const speedRush = Math.min(1.0, this.airspeed / 24.0);
    const altBreeze = Math.min(1.0, Math.max(0, (this.altitude - 6.0) / 48.0));
    const clampedBank = Math.max(-1.0, Math.min(1.0, bankAngle / 0.75));
    const turnSwoop = this.isFlying ? Math.abs(clampedBank) * (0.35 + speedRush * 0.65) : 0.0;

    if (this.windGainL && this.windFilterL && this.windGainR && this.windFilterR) {
      const baseWind =
        (0.022 + altBreeze * 0.024 + (this.isFlying ? speedRush * 0.034 + turnSwoop * 0.018 : 0)) *
        indoorAtten;
      const bankBiasL = Math.max(0.45, 1.0 - clampedBank * 0.42);
      const bankBiasR = Math.max(0.45, 1.0 + clampedBank * 0.42);

      this.setParamTargetIfDirty(
        this.windGainL.gain,
        baseWind * (0.75 + gustL * 0.45) * bankBiasL,
        now,
        0.12,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.windGainR.gain,
        baseWind * (0.75 + gustR * 0.45) * bankBiasR,
        now,
        0.12,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.windFilterL.frequency,
        235 + gustL * 135 + speedRush * 195 + turnSwoop * 135 * bankBiasL,
        now,
        0.14,
        FREQ_EPSILON
      );
      this.setParamTargetIfDirty(
        this.windFilterR.frequency,
        305 + gustR * 155 + speedRush * 215 + turnSwoop * 135 * bankBiasR,
        now,
        0.14,
        FREQ_EPSILON
      );
      if (this.windPanL && this.windPanR) {
        this.setParamTargetIfDirty(
          this.windPanL.pan,
          Math.max(-0.92, Math.min(-0.15, -0.52 - clampedBank * 0.28)),
          now,
          0.12,
          0.02
        );
        this.setParamTargetIfDirty(
          this.windPanR.pan,
          Math.max(0.15, Math.min(0.92, 0.52 - clampedBank * 0.28)),
          now,
          0.12,
          0.02
        );
      }
    }

    if (this.updraftRushGain && this.updraftRushFilter) {
      const updraftNorm = this.isFlying ? Math.min(1.0, thermalLift / 8.5) : 0.0;
      this.setParamTargetIfDirty(
        this.updraftRushGain.gain,
        0.0001 + updraftNorm * 0.044 * indoorAtten,
        now,
        0.12,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.updraftRushFilter.frequency,
        330 + updraftNorm * 360 + 65 * Math.sin(this.ambientClock * 3.1),
        now,
        0.14,
        FREQ_EPSILON
      );
    }

    // --- 2. Continuous Steep-Dive Air-Rush & Soft Whistle (only on true steep dives < -13.5 SU/s) ---
    if (this.fallRushGain && this.fallRushFilter && this.fallWhistleGain && this.fallWhistleOsc) {
      const fallFactor =
        this.isFlying && this.verticalVel < -13.5
          ? Math.min(1.0, (-this.verticalVel - 13.5) / 14.0)
          : 0.0;
      this.setParamTargetIfDirty(
        this.fallRushGain.gain,
        0.0001 + fallFactor * 0.052,
        now,
        0.08,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.fallRushFilter.frequency,
        460 + fallFactor * 580,
        now,
        0.08,
        FREQ_EPSILON
      );
      this.setParamTargetIfDirty(
        this.fallWhistleGain.gain,
        0.0001 + fallFactor * 0.0055,
        now,
        0.08,
        GAIN_EPSILON
      );
      this.setParamTargetIfDirty(
        this.fallWhistleOsc.frequency,
        780 - fallFactor * 240,
        now,
        0.08,
        FREQ_EPSILON
      );
    }

    // --- 3. 3D Spatialized Environmental Micro-Foley & Canopy Bird Chorus ---
    this.foleyTimer -= dt;
    if (this.foleyTimer <= 0) {
      this.foleyTimer = this.isIndoors ? 2.1 + Math.random() * 2.2 : 0.85 + Math.random() * 1.15;
      this.triggerSpatialAmbientFoley();
    }

    this.ambientBirdTimer -= dt;
    if (this.ambientBirdTimer <= 0) {
      this.ambientBirdTimer = this.isIndoors
        ? 20.0 + Math.random() * 26.0
        : 10.0 + Math.random() * 12.0;
      this.triggerAmbientCanopyBird();
    }

    // --- 4. Sparse Minimalist Mallet Score (Multi-Second Breathing Pauses + Subtle Occasional Flourish) ---
    if (this.isFlying && !this.isIndoors) {
      this.actionEnergy = Math.min(1.0, this.actionEnergy + dt * (0.36 + speedRush * 0.42));
      this.idleStillnessTimer = 0;
    } else if (this.isHopping && !this.isIndoors) {
      this.actionEnergy = Math.min(0.68, this.actionEnergy + dt * 0.18);
      this.idleStillnessTimer = 0;
    } else {
      this.idleStillnessTimer += dt;
      this.actionEnergy = Math.max(0.0, this.actionEnergy - dt * 0.55);
    }

    if (this.chaosEnergy > 0) {
      this.chaosEnergy = Math.max(0.0, this.chaosEnergy - dt * 0.22);
    }

    if (this.activeMotifQueue.length > 0) {
      // Stillness tail fade: let the final note ring into silence when settled
      if (
        this.idleStillnessTimer > 0.9 &&
        this.chaosEnergy < 0.15 &&
        this.activeMotifQueue.length > 1
      ) {
        this.activeMotifQueue.length = 1;
      }
      if (this.nextMotifStepTime < now - 0.1) {
        this.nextMotifStepTime = now;
      }
      const lookaheadHorizon = now + MOTIF_LOOKAHEAD_SEC;
      while (this.activeMotifQueue.length > 0 && this.nextMotifStepTime <= lookaheadHorizon) {
        this.stepMinimalistMalletMotif(Math.max(now, this.nextMotifStepTime));
      }
    } else {
      if (this.phraseCooldown > 0) {
        this.phraseCooldown -= dt;
      } else if (this.actionEnergy > 0.46 || this.chaosEnergy > 0.42) {
        this.startNewMalletPhrase(now);
      }
    }
  }

  private playIndoorClockTick(isTick: boolean): void {
    if (!this.ctx || !this.ambienceGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const pitch = isTick ? 920 : 710;
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.42, now + 0.022);

    const panner = this.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 12;
    panner.rolloffFactor = 1.0;
    panner.positionX.value = -76.0;
    panner.positionY.value = 39.2;
    panner.positionZ.value = 43.5;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.036, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);

    osc.connect(g);
    g.connect(panner);
    panner.connect(this.ambienceGain);
    this.disconnectOnEnded(osc, osc, g, panner);
    osc.start(now);
    osc.stop(now + 0.032);
  }

  private playTowerEscapementTick(isTick: boolean): void {
    if (!this.ctx || !this.outdoorFilter) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut({ x: 96.0, y: 52.0, z: -96.0 }, 18, 0.92, true);
    const pitch = isTick ? 420 : 318;

    const anchor = this.ctx.createOscillator();
    anchor.type = 'triangle';
    anchor.frequency.setValueAtTime(pitch, now);
    anchor.frequency.exponentialRampToValueAtTime(pitch * 0.36, now + 0.048);

    const chime = this.ctx.createOscillator();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(pitch * 2.75, now);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.068, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.022, now);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    anchor.connect(g);
    chime.connect(cg);
    g.connect(sp.dest);
    cg.connect(sp.dest);
    this.disconnectOnEnded(chime, chime, cg);
    this.disconnectOnEnded(anchor, anchor, g, ...sp.cleanup);
    anchor.start(now);
    chime.start(now);
    chime.stop(now + 0.05);
    anchor.stop(now + 0.082);
  }

  private playTramRailJointClack(tramX: number, speedNorm: number): void {
    if (!this.ctx || !this.outdoorFilter) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut({ x: tramX, y: 0.75, z: 0.0 }, 15, 1.08, true);
    const gap = Math.max(0.045, 0.082 - speedNorm * 0.028);
    const bogieDelay = Math.max(0.15, 0.28 - speedNorm * 0.085);
    const offsets = [0, gap, bogieDelay, bogieDelay + gap];
    const ampBase = 0.048 + speedNorm * 0.068;

    offsets.forEach((off, idx) => {
      const t0 = now + off;
      const isSecondAxle = idx % 2 === 1;
      const thump = this.ctx!.createOscillator();
      thump.type = 'triangle';
      const f0 = (isSecondAxle ? 168 : 192) * (0.96 + Math.random() * 0.08);
      thump.frequency.setValueAtTime(f0, t0);
      thump.frequency.exponentialRampToValueAtTime(62, t0 + 0.042);

      const tg = this.ctx!.createGain();
      tg.gain.setValueAtTime(ampBase * (idx >= 2 ? 0.84 : 1.0), t0);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.048);
      thump.connect(tg);
      tg.connect(sp.dest);

      const click = this.ctx!.createOscillator();
      click.type = 'sine';
      click.frequency.setValueAtTime(isSecondAxle ? 2180 : 2540, t0);
      click.frequency.exponentialRampToValueAtTime(920, t0 + 0.016);
      const cg = this.ctx!.createGain();
      cg.gain.setValueAtTime(ampBase * 0.42, t0);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.019);
      click.connect(cg);
      cg.connect(sp.dest);

      this.disconnectOnEnded(click, click, cg);
      if (idx === offsets.length - 1) {
        this.disconnectOnEnded(thump, thump, tg, ...sp.cleanup);
      } else {
        this.disconnectOnEnded(thump, thump, tg);
      }
      thump.start(t0);
      click.start(t0);
      click.stop(t0 + 0.022);
      thump.stop(t0 + 0.054);
    });
  }

  /**
   * Synthesizes & caches an Extended Karplus-Strong physical-modeling plucked acoustic guitar
   * string AudioBuffer (pluck-position comb-filtered flesh/nail excitation + fractional-delay
   * damped string waveguide with wound-bronze bass warmth and steel/nylon treble ring).
   */
  private getOrCreateGuitarStringBuffer(
    freq: number,
    style: 'thumb' | 'finger' | 'strum'
  ): AudioBuffer | null {
    if (!this.ctx) return null;
    const quantizedHz = Math.round(Math.max(72, Math.min(880, freq)) * 2.0) * 0.5;
    const key = `${quantizedHz.toFixed(1)}_${style}`;
    const cached = this.guitarStringBufCache.get(key);
    if (cached) return cached;

    const sr = this.ctx.sampleRate;
    const dur = style === 'thumb' ? 1.72 : 1.42;
    const totalSamples = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, totalSamples, sr);
    const out = buf.getChannelData(0);

    const period = sr / quantizedHz;
    const delayInt = Math.max(4, Math.floor(period - 0.5));
    const frac = Math.max(0, Math.min(0.999, period - delayInt));

    // Seed deterministic pseudo-random generator per string pitch so cached timbre is consistent & warm
    let rng = (Math.floor(quantizedHz * 173.3) ^ (style === 'thumb' ? 0x51a7 : style === 'strum' ? 0x9e37 : 0x2c1b)) >>> 0;
    const nextRand = (): number => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return (rng / 4294967296) * 2 - 1;
    };

    // 1. Pluck-Position Comb Excitation (soundhole/bridge pluck ratio beta ~ 0.13..0.22)
    const rawExcite = new Float32Array(delayInt + 4);
    let lpExcite = 0;
    const exciteAlpha = style === 'thumb' ? 0.24 : style === 'strum' ? 0.56 : 0.44;
    for (let i = 0; i < rawExcite.length; i++) {
      const u = i / delayInt;
      // Smooth triangular string-displacement ramp + flesh/nail filtered transient
      const stringRamp = u < 0.18 ? u / 0.18 : (1.0 - u) / 0.82;
      const white = nextRand();
      lpExcite = lpExcite + exciteAlpha * (white - lpExcite);
      rawExcite[i] = lpExcite * 0.72 + (stringRamp * 2.0 - 1.0) * 0.36;
    }

    const ring = new Float32Array(delayInt + 4);
    const pluckBeta = style === 'thumb' ? 0.23 : style === 'strum' ? 0.13 : 0.17;
    const combOffset = Math.max(1, Math.floor(delayInt * pluckBeta));
    for (let i = 0; i < delayInt; i++) {
      const delayedIdx = (i - combOffset + delayInt) % delayInt;
      ring[i] = rawExcite[i] - 0.76 * rawExcite[delayedIdx];
    }

    // 2. Fractional-Delay Damped String Waveguide Loop
    const targetT60 = quantizedHz < 165 ? 1.85 : quantizedHz < 290 ? 1.52 : 1.25;
    const loopGain = Math.min(0.9987, Math.max(0.9905, Math.pow(0.001, 1.0 / (targetT60 * quantizedHz))));
    const dampingBlend =
      style === 'thumb'
        ? 0.44
        : style === 'strum'
          ? quantizedHz < 190
            ? 0.28
            : 0.20
          : 0.25;

    let writeIdx = 0;
    let prevLp = 0;
    let dcPrevX = 0;
    let dcPrevY = 0;
    let peak = 0.001;

    for (let n = 0; n < totalSamples; n++) {
      const idxA = writeIdx;
      const idxB = (writeIdx + 1) % delayInt;
      // Fractional-delay interpolation along string waveguide
      const delayedSample = ring[idxA] * (1.0 - frac) + ring[idxB] * frac;
      // Two-point string bridge lowpass damping
      const damped = delayedSample * (1.0 - dampingBlend) + prevLp * dampingBlend;
      prevLp = delayedSample;
      const nextVal = damped * loopGain;
      ring[writeIdx] = nextVal;
      writeIdx = idxB;

      // Subtle fingernail/pick transient crispness in the first 3.5 ms
      let sample = nextVal;
      if (n < sr * 0.0035 && style !== 'thumb') {
        const env = 1.0 - n / (sr * 0.0035);
        sample += nextRand() * env * env * (style === 'strum' ? 0.18 : 0.11);
      }

      // Gentle DC blocker + end fade-out
      const dcY = sample - dcPrevX + 0.996 * dcPrevY;
      dcPrevX = sample;
      dcPrevY = dcY;
      const fadeOut = n > totalSamples - 1200 ? (totalSamples - n) / 1200 : 1.0;
      const finalSample = dcY * fadeOut;
      out[n] = finalSample;
      const absS = Math.abs(finalSample);
      if (absS > peak) peak = absS;
    }

    const normScale = 0.9 / peak;
    for (let n = 0; n < totalSamples; n++) {
      out[n] *= normScale;
    }

    this.guitarStringBufCache.set(key, buf);
    return buf;
  }

  private stepBuskerGuitarPerformance(stepTime: number): void {
    const cell = MODAL_CELLS[this.modalIndex];
    const step = this.buskerPatternStep % 8;
    const bar = this.buskerBarCount;
    const grooving = this.buskerGrooveActive || this.fountainGeyserActive;

    // Transpose gently around open-position concert guitar voicings (G6/9 -> Cadd9 -> Em9 -> Dadd11/F#)
    const transpose = Math.max(0.88, Math.min(1.16, (cell.bassRoot < 92 ? cell.bassRoot * 2.0 : cell.bassRoot) / 98.0));
    const GUITAR_VOICINGS: ReadonlyArray< readonly [number, number, number, number, number, number] > = [
      [98.0, 146.83, 196.0, 246.94, 329.63, 392.0],    // G6/9 (warm tonic)
      [130.81, 164.81, 196.0, 293.66, 329.63, 392.0],  // Cadd9 (luminous subdominant)
      [82.41, 123.47, 196.0, 246.94, 293.66, 369.99],  // Em9 (deep open E2 bass)
      [92.50, 146.83, 220.0, 293.66, 369.99, 392.0],   // Dadd11/F# (warm turnaround)
    ];
    const chord = GUITAR_VOICINGS[bar % 4];
    const s0 = chord[0] * transpose; // 6th string (root bass)
    const s1 = chord[1] * transpose; // 5th/4th string (fifth/third bass)
    const s2 = chord[2] * transpose; // 4th/3rd string (inner voice)
    const s3 = chord[3] * transpose; // 3rd/2nd string (tenor)
    const s4 = chord[4] * transpose; // 2nd string (alto)
    const s5 = chord[5] * transpose; // 1st string (high E melody)

    if (grooving) {
      // Lively Mediterranean Rumba / Rasgueado Acoustic Groove:
      // Rolled 6-string down-strums, crisp up-strums, wooden spruce soundboard golpes & singing melody
      if (step === 0) {
        const fullChord = [s0, s1, s2, s3, s4, s5];
        fullChord.forEach((f, i) => {
          this.triggerBuskerString(
            f,
            0.22 - i * 0.016,
            stepTime + i * 0.016,
            1.22,
            i < 2 ? 'thumb' : 'strum'
          );
        });
      } else if (step === 2) {
        this.triggerGuitarBodyTap(stepTime, 0.13);
        this.triggerBuskerString(s3, 0.14, stepTime + 0.014, 1.08, 'finger');
        this.triggerBuskerString(s4, 0.15, stepTime + 0.028, 1.12, 'finger');
      } else if (step === 3) {
        // Syncopated crisp treble upstroke
        [s5, s4, s3].forEach((f, i) => {
          this.triggerBuskerString(f, 0.165 - i * 0.018, stepTime + i * 0.014, 1.24, 'strum');
        });
      } else if (step === 4) {
        this.triggerBuskerString(s1, 0.21, stepTime, 0.95, 'thumb');
        this.triggerBuskerString(s2, 0.15, stepTime + 0.018, 1.05, 'finger');
      } else if (step === 5) {
        this.triggerBuskerString(bar % 2 === 0 ? s5 : s5 * 1.122, 0.175, stepTime, 1.18, 'finger');
      } else if (step === 6) {
        this.triggerGuitarBodyTap(stepTime, 0.11);
        [s2, s3, s4, s5].forEach((f, i) => {
          this.triggerBuskerString(f, 0.16 - i * 0.012, stepTime + 0.012 + i * 0.015, 1.18, 'strum');
        });
      } else if (step === 7 && bar % 2 === 1) {
        this.triggerFretSlideSqueak(stepTime - 0.025);
        this.triggerBuskerString(s4, 0.135, stepTime, 1.05, 'finger');
      }
      this.buskerPatternStep = (step + 1) % 8;
      if (this.buskerPatternStep === 0) this.buskerBarCount++;
      this.buskerNextStepTime = stepTime + 0.172 + (step % 2 === 1 ? 0.012 : 0);
      return;
    }

    // Alternate 4-bar phrases between intimate Travis/Spanish fingerpicking and warm rolled folk strums
    const isStrumPhrase = Math.floor(bar / 4) % 2 === 1;
    if (isStrumPhrase) {
      if (step === 0) {
        // Warm rolled 5-string downstroke
        [s0, s1, s2, s3, s4].forEach((f, i) => {
          this.triggerBuskerString(
            f,
            0.195 - i * 0.014,
            stepTime + i * 0.019,
            1.08,
            i === 0 ? 'thumb' : 'strum'
          );
        });
      } else if (step === 2) {
        this.triggerBuskerString(s2, 0.125, stepTime, 0.98, 'finger');
      } else if (step === 3) {
        // Gentle brush upstroke across top 3 strings
        [s5, s4, s3].forEach((f, i) => {
          this.triggerBuskerString(f, 0.145 - i * 0.016, stepTime + i * 0.016, 1.12, 'strum');
        });
      } else if (step === 4) {
        this.triggerBuskerString(s1, 0.185, stepTime, 0.92, 'thumb');
        if (bar % 2 === 1) {
          this.triggerGuitarBodyTap(stepTime + 0.008, 0.085);
        }
      } else if (step === 6) {
        [s1, s2, s3, s4, s5].forEach((f, i) => {
          this.triggerBuskerString(f, 0.165 - i * 0.013, stepTime + i * 0.017, 1.14, 'strum');
        });
      } else if (step === 7) {
        if (bar % 2 === 1) {
          this.triggerFretSlideSqueak(stepTime + 0.04);
        } else {
          this.triggerBuskerString(s3, 0.115, stepTime, 0.96, 'finger');
        }
      }
    } else {
      // Warm Travis / Spanish Classical Fingerpicking with delicate hammer-on grace notes
      const restTurnaround = bar % 4 === 3 && step === 7;
      if (!restTurnaround) {
        if (step === 0) {
          this.triggerBuskerString(s0, 0.205, stepTime, 0.9, 'thumb');
          this.triggerBuskerString(s4, 0.165, stepTime + 0.022, 1.12, 'finger');
          if (bar % 2 === 0) {
            // Expressive hammer-on ornament on 1st/2nd string
            this.triggerBuskerString(s5, 0.135, stepTime + 0.095, 1.08, 'finger');
          }
        } else if (step === 1) {
          this.triggerBuskerString(s2, 0.138, stepTime, 0.96, 'finger');
        } else if (step === 2) {
          this.triggerBuskerString(s1, 0.168, stepTime, 0.88, 'thumb');
          this.triggerBuskerString(s3, 0.145, stepTime + 0.016, 1.04, 'finger');
        } else if (step === 3) {
          this.triggerBuskerString(s5, 0.155, stepTime, 1.14, 'finger');
        } else if (step === 4) {
          this.triggerBuskerString(s0, 0.188, stepTime, 0.88, 'thumb');
          if (bar % 2 === 1) {
            this.triggerFretSlideSqueak(stepTime - 0.028);
          }
        } else if (step === 5) {
          this.triggerBuskerString(s2, 0.135, stepTime, 0.96, 'finger');
        } else if (step === 6) {
          const melFreq = bar % 3 === 1 ? s5 * 1.122 : s4;
          this.triggerBuskerString(s1, 0.158, stepTime, 0.88, 'thumb');
          this.triggerBuskerString(melFreq, 0.168, stepTime + 0.018, 1.15, 'finger');
        } else if (step === 7) {
          this.triggerBuskerString(s3, 0.128, stepTime, 0.94, 'finger');
        }
      }
    }

    this.buskerPatternStep = (step + 1) % 8;
    if (this.buskerPatternStep === 0) this.buskerBarCount++;
    const rubato = step === 0 || step === 4 ? 0.248 : 0.228;
    this.buskerNextStepTime = stepTime + rubato + Math.sin(this.buskerBarCount * 0.9 + step) * 0.008;
  }

  private triggerBuskerString(
    freq: number,
    volume: number,
    startTime: number,
    brightness = 1.0,
    style: 'thumb' | 'finger' | 'strum' = freq < 175 ? 'thumb' : 'finger'
  ): void {
    if (!this.ctx || !this.buskerBodyEq) return;
    const buf = this.getOrCreateGuitarStringBuffer(freq, style);
    if (!buf) return;

    const t0 = Math.max(this.ctx.currentTime, startTime);
    this.buskerNotesPlayed++;

    const quantizedHz = Math.round(Math.max(72, Math.min(880, freq)) * 2.0) * 0.5;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // Exact pitch ratio + natural organic ±3.5 cent human string micro-detune
    const microDetune = 1.0 + (Math.random() - 0.5) * 0.004;
    src.playbackRate.setValueAtTime((freq / quantizedHz) * microDetune, t0);

    const toneFilter = this.ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.setValueAtTime(Math.min(6200, 2100 + freq * 4.2 * brightness), t0);
    toneFilter.frequency.exponentialRampToValueAtTime(Math.max(420, freq * 2.4), t0 + 1.15);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(volume, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + buf.duration - 0.02);

    src.connect(toneFilter);
    toneFilter.connect(env);
    env.connect(this.buskerBodyEq);

    this.disconnectOnEnded(src, src, toneFilter, env);
    src.start(t0);
  }

  private triggerGuitarBodyTap(startTime: number, volume = 0.11): void {
    if (!this.ctx || !this.buskerBodyEq) return;
    const t0 = Math.max(this.ctx.currentTime, startTime);

    // 1. Hollow spruce soundboard air thump (~98 Hz)
    const airTap = this.ctx.createOscillator();
    airTap.type = 'sine';
    airTap.frequency.setValueAtTime(142, t0);
    airTap.frequency.exponentialRampToValueAtTime(76, t0 + 0.062);
    const ag = this.ctx.createGain();
    ag.gain.setValueAtTime(volume, t0);
    ag.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.078);
    airTap.connect(ag);
    ag.connect(this.buskerBodyEq);
    this.disconnectOnEnded(airTap, airTap, ag);
    airTap.start(t0);
    airTap.stop(t0 + 0.084);

    // 2. Crisp knuckle/palm wood transient (~340 Hz)
    const woodKnock = this.ctx.createOscillator();
    woodKnock.type = 'triangle';
    woodKnock.frequency.setValueAtTime(385, t0);
    woodKnock.frequency.exponentialRampToValueAtTime(168, t0 + 0.024);
    const wg = this.ctx.createGain();
    wg.gain.setValueAtTime(volume * 0.52, t0);
    wg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.028);
    woodKnock.connect(wg);
    wg.connect(this.buskerBodyEq);
    this.disconnectOnEnded(woodKnock, woodKnock, wg);
    woodKnock.start(t0);
    woodKnock.stop(t0 + 0.032);
  }

  private triggerFretSlideSqueak(startTime: number): void {
    if (!this.ctx || !this.buskerBodyEq || !this.chiffBuf) return;
    const t0 = Math.max(this.ctx.currentTime, startTime);
    // Authentic wound-bronze acoustic string finger-slide squeak (bandpass-swept friction noise)
    const src = this.ctx.createBufferSource();
    src.buffer = this.chiffBuf;
    src.playbackRate.setValueAtTime(0.88 + Math.random() * 0.2, t0);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2050, t0);
    bp.frequency.exponentialRampToValueAtTime(2680, t0 + 0.052);
    bp.Q.value = 6.5;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.055, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.058);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.buskerBodyEq);
    this.disconnectOnEnded(src, src, bp, g);
    src.start(t0);
  }

  // ==========================================================================
  // Minimalist Acoustic Mallet Sequencer
  // ==========================================================================

  private startNewMalletPhrase(now: number): void {
    if (Math.random() < 0.55) {
      this.modalIndex = (this.modalIndex + 1) % MODAL_CELLS.length;
    }
    const cell = MODAL_CELLS[this.modalIndex];
    const motif = cell.motifs[Math.floor(Math.random() * cell.motifs.length)];
    this.activeMotifQueue = [...motif];

    // Occasional light flourish when soaring briskly or right after mischief
    this.phraseHasFlourish =
      (this.isFlying && (this.altitude > 16 || this.airspeed > 14.5) && Math.random() < 0.48) ||
      (this.chaosEnergy > 0.3 && Math.random() < 0.68);
    if (this.phraseHasFlourish) {
      const topIdx = Math.min(
        cell.malletScale.length - 1,
        motif[motif.length - 1] + (this.verticalVel < -6.5 ? 2 : 1)
      );
      this.activeMotifQueue.push(motif[1] ?? motif[0], topIdx);
    }

    this.activeMotifStep = 0;
    this.activeMotifTotal = this.activeMotifQueue.length;
    this.currentStepInterval = this.isFlying ? 0.21 : 0.27;
    this.nextMotifStepTime = now + 0.01;

    this.triggerBassMarimbaNote(cell.bassRoot, 0.12, this.nextMotifStepTime);
  }

  private stepMinimalistMalletMotif(stepTime: number): void {
    const scaleIdx = this.activeMotifQueue.shift();
    if (scaleIdx === undefined) return;

    const cell = MODAL_CELLS[this.modalIndex];
    const freq = cell.malletScale[scaleIdx % cell.malletScale.length];
    const step = this.activeMotifStep;
    const total = Math.max(1, this.activeMotifTotal);
    const progress = total > 1 ? step / (total - 1) : 0.5;

    const arc = Math.sin(progress * Math.PI);
    const vel = 0.072 + arc * 0.062;
    const pan = (step % 2 === 0 ? -1 : 1) * 0.24;

    this.triggerMarimbaNote(freq, vel, pan, stepTime);

    const isPeak = step === Math.floor(total * 0.5);
    if (
      isPeak &&
      (this.altitude > 22 ||
        this.anyVignetteUnlocked ||
        this.buskerProximity > 0.35 ||
        this.phraseHasFlourish)
    ) {
      this.triggerVibraphoneNote(freq * 2.0, vel * 0.35, 2.4, stepTime);
    }

    // Subtle occasional harp ornament (at most 1-2 gentle grace notes on flourished phrases)
    if (this.phraseHasFlourish && (isPeak || this.activeMotifQueue.length === 0)) {
      const harmFreq = cell.malletScale[(scaleIdx + 4) % cell.malletScale.length];
      this.triggerPluckedHarpNote(
        harmFreq,
        vel * 0.38,
        -pan,
        stepTime + this.currentStepInterval * 0.5
      );
    }

    this.activeMotifStep++;
    const asymmetricBreath = this.activeMotifStep % 3 === 2 ? 1.5 : 1.0;
    this.nextMotifStepTime = stepTime + this.currentStepInterval * asymmetricBreath;

    if (this.activeMotifQueue.length === 0) {
      this.actionEnergy *= 0.25;
      this.phraseCooldown =
        this.chaosEnergy > 0.28 ? 5.2 + Math.random() * 4.0 : 8.5 + Math.random() * 7.0;
    }
  }

  // ==========================================================================
  // Acoustic Minimalist Mallet Instruments
  // ==========================================================================

  public triggerMarimbaNote(freq: number, volume = 0.12, pan = 0, startTime?: number): void {
    if (!this.ctx || !this.musicGain) return;
    const t0 = startTime !== undefined ? Math.max(this.ctx.currentTime, startTime) : this.ctx.currentTime;

    const pNode = this.ctx.createStereoPanner();
    pNode.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    pNode.connect(this.musicGain);

    const fund = this.ctx.createOscillator();
    fund.type = 'sine';
    fund.frequency.setValueAtTime(freq, t0);

    const fundEnv = this.ctx.createGain();
    fundEnv.gain.setValueAtTime(0.0001, t0);
    fundEnv.gain.linearRampToValueAtTime(volume, t0 + 0.006);
    fundEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.92);
    fund.connect(fundEnv);
    fundEnv.connect(pNode);

    const overtone = this.ctx.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(freq * 3.98, t0);
    const overEnv = this.ctx.createGain();
    overEnv.gain.setValueAtTime(0.0001, t0);
    overEnv.gain.linearRampToValueAtTime(volume * 0.32, t0 + 0.003);
    overEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.065);
    overtone.connect(overEnv);
    overEnv.connect(pNode);

    const clickOsc = this.ctx.createOscillator();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(Math.min(2100, freq * 5.0), t0);
    clickOsc.frequency.exponentialRampToValueAtTime(freq * 1.5, t0 + 0.014);
    const clickEnv = this.ctx.createGain();
    clickEnv.gain.setValueAtTime(volume * 0.2, t0);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.016);
    clickOsc.connect(clickEnv);
    clickEnv.connect(pNode);

    this.disconnectOnEnded(clickOsc, clickOsc, clickEnv);
    this.disconnectOnEnded(overtone, overtone, overEnv);
    this.disconnectOnEnded(fund, fund, fundEnv, pNode);

    fund.start(t0);
    overtone.start(t0);
    clickOsc.start(t0);
    fund.stop(t0 + 0.96);
    overtone.stop(t0 + 0.08);
    clickOsc.stop(t0 + 0.02);
  }

  private triggerPluckedHarpNote(freq: number, volume = 0.08, pan = 0, startTime?: number): void {
    if (!this.ctx || !this.musicGain) return;
    const t0 = startTime !== undefined ? Math.max(this.ctx.currentTime, startTime) : this.ctx.currentTime;

    const pNode = this.ctx.createStereoPanner();
    pNode.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    pNode.connect(this.musicGain);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(4800, freq * 6.5), t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(320, freq * 1.35), t0 + 0.65);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(volume, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.15);

    const osc1 = this.ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, t0);

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2.002, t0);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.28;

    osc1.connect(lp);
    osc2.connect(g2);
    g2.connect(lp);
    lp.connect(env);
    env.connect(pNode);

    this.disconnectOnEnded(osc2, osc2, g2);
    this.disconnectOnEnded(osc1, osc1, lp, env, pNode);

    osc1.start(t0);
    osc2.start(t0);
    osc2.stop(t0 + 1.18);
    osc1.stop(t0 + 1.2);
  }

  public triggerVibraphoneNote(
    freq: number,
    volume = 0.075,
    duration = 2.2,
    startTime?: number
  ): void {
    if (!this.ctx || !this.musicGain) return;
    const t0 = startTime !== undefined ? Math.max(this.ctx.currentTime, startTime) : this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);

    const harm = this.ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(freq * 3.0, t0);

    const trem = this.ctx.createOscillator();
    const tremDepth = this.ctx.createGain();
    trem.frequency.value = 5.2;
    tremDepth.gain.value = volume * 0.16;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(volume, t0 + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    const harmEnv = this.ctx.createGain();
    harmEnv.gain.setValueAtTime(volume * 0.12, t0);
    harmEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);

    trem.connect(tremDepth);
    tremDepth.connect(env.gain);
    osc.connect(env);
    harm.connect(harmEnv);
    env.connect(this.musicGain);
    harmEnv.connect(this.musicGain);

    this.disconnectOnEnded(harm, harm, harmEnv);
    this.disconnectOnEnded(trem, trem, tremDepth);
    this.disconnectOnEnded(osc, osc, env);

    osc.start(t0);
    harm.start(t0);
    trem.start(t0);
    osc.stop(t0 + duration + 0.055);
    harm.stop(t0 + 0.3);
    trem.stop(t0 + duration + 0.05);
  }

  private triggerBassMarimbaNote(freq: number, volume = 0.14, startTime?: number): void {
    if (!this.ctx || !this.musicGain) return;
    const t0 = startTime !== undefined ? Math.max(this.ctx.currentTime, startTime) : this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.01, t0);
    osc.frequency.exponentialRampToValueAtTime(freq, t0 + 0.025);

    const over = this.ctx.createOscillator();
    over.type = 'triangle';
    over.frequency.setValueAtTime(freq * 2.0, t0);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(340, t0);
    lp.frequency.exponentialRampToValueAtTime(140, t0 + 0.9);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);

    const overGain = this.ctx.createGain();
    overGain.gain.value = 0.25;

    osc.connect(lp);
    over.connect(overGain);
    overGain.connect(lp);
    lp.connect(env);
    env.connect(this.musicGain);

    this.disconnectOnEnded(over, over, overGain);
    this.disconnectOnEnded(osc, osc, lp, env);

    osc.start(t0);
    over.start(t0);
    osc.stop(t0 + 1.56);
    over.stop(t0 + 1.55);
  }

  // ==========================================================================
  // 3D Spatialized Environmental Micro-Foley & Canopy Bird Chorus
  // ==========================================================================

  private triggerSpatialAmbientFoley(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    if (this.isIndoors) {
      const r = Math.random();
      if (r < 0.45) {
        // Warm wooden atelier rafter / easel settle creak
        const pos = {
          x: -66 + (Math.random() - 0.5) * 18,
          y: 41 + Math.random() * 5,
          z: 48 + (Math.random() - 0.5) * 16,
        };
        const sp = this.createSpatialOneShotOut(pos, 10, 1.1, false);
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        const f0 = 155 + Math.random() * 55;
        osc.frequency.setValueAtTime(f0, now);
        osc.frequency.linearRampToValueAtTime(f0 * 1.18, now + 0.16);
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 380;
        bp.Q.value = 3.5;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.032, now + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.connect(bp);
        bp.connect(g);
        g.connect(sp.dest);
        this.disconnectOnEnded(osc, osc, bp, g, ...sp.cleanup);
        osc.start(now);
        osc.stop(now + 0.24);
      } else {
        // Fluttering sketchbook paper / breeze rustle near the East French Window
        if (!this.ruffleBuf) return;
        const pos = {
          x: -42 + (Math.random() - 0.5) * 4,
          y: 36 + Math.random() * 4,
          z: 52 + (Math.random() - 0.5) * 8,
        };
        const sp = this.createSpatialOneShotOut(pos, 10, 1.1, false);
        const src = this.ctx.createBufferSource();
        src.buffer = this.ruffleBuf;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1650 + Math.random() * 450;
        bp.Q.value = 1.4;
        const g = this.ctx.createGain();
        g.gain.value = 0.045 + this.windowOpenRatio * 0.035;
        src.connect(bp);
        bp.connect(g);
        g.connect(sp.dest);
        this.disconnectOnEnded(src, src, bp, g, ...sp.cleanup);
        src.start(now);
      }
      return;
    }

    const roll = Math.random();
    if (roll < 0.26) {
      // 1. Fountain splashing droplets & bubbling water plops around (48, 2.2, 48)
      const ang = Math.random() * Math.PI * 2;
      const rad = 2.0 + Math.random() * 7.5;
      const pos = { x: 48.0 + Math.cos(ang) * rad, y: 2.2 + Math.random() * 4.5, z: 48.0 + Math.sin(ang) * rad };
      const sp = this.createSpatialOneShotOut(pos, 16, 1.05, true);
      const droplets = 2 + Math.floor(Math.random() * 2);
      for (let d = 0; d < droplets; d++) {
        const t0 = now + d * (0.045 + Math.random() * 0.05);
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        const f = 460 + Math.random() * 420;
        osc.frequency.setValueAtTime(f, t0);
        osc.frequency.exponentialRampToValueAtTime(f * 1.85, t0 + 0.055);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.065, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
        osc.connect(g);
        g.connect(sp.dest);
        if (d === droplets - 1) {
          this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
        } else {
          this.disconnectOnEnded(osc, osc, g);
        }
        osc.start(t0);
        osc.stop(t0 + 0.08);
      }
    } else if (roll < 0.50) {
      // 2. Tree-crown leaf rustle gust from a nearby canopy perch
      if (!this.ruffleBuf) return;
      const tree = OUTDOOR_CANOPY_PERCHES[Math.floor(Math.random() * OUTDOOR_CANOPY_PERCHES.length)];
      const sp = this.createSpatialOneShotOut(tree, 18, 0.95, true);
      for (let p = 0; p < 2; p++) {
        const t0 = now + p * 0.075;
        const src = this.ctx.createBufferSource();
        src.buffer = this.ruffleBuf;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1450 + p * 320 + Math.random() * 350;
        bp.Q.value = 1.25;
        const g = this.ctx.createGain();
        g.gain.value = 0.075;
        src.connect(bp);
        bp.connect(g);
        g.connect(sp.dest);
        if (p === 1) {
          this.disconnectOnEnded(src, src, bp, g, ...sp.cleanup);
        } else {
          this.disconnectOnEnded(src, src, bp, g);
        }
        src.start(t0);
      }
    } else if (roll < 0.72) {
      // 3. Café bistro porcelain cup/saucer clink or soft espresso steam puff at NW Terrace
      const pos = {
        x: -28.0 + (Math.random() - 0.5) * 14,
        y: 3.6,
        z: 45.0 + (Math.random() - 0.5) * 14,
      };
      const sp = this.createSpatialOneShotOut(pos, 16, 1.05, true);
      if (Math.random() < 0.65) {
        const f = 2250 + Math.random() * 480;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now);
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(f * 2.38, now);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.052, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        osc.connect(g);
        osc2.connect(g);
        g.connect(sp.dest);
        this.disconnectOnEnded(osc2, osc2);
        this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
        osc.start(now);
        osc2.start(now);
        osc2.stop(now + 0.155);
        osc.stop(now + 0.16);
      } else if (this.ruffleBuf) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.ruffleBuf;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.value = 3400;
        hp.Q.value = 1.6;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.06, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        src.connect(hp);
        hp.connect(g);
        g.connect(sp.dest);
        this.disconnectOnEnded(src, src, hp, g, ...sp.cleanup);
        src.start(now);
      }
    } else if (roll < 0.88) {
      // 4. Canal wooden boat creak & gentle water lap along SW Canal
      const cx = Math.max(-120, Math.min(-26, this.birdPos.x + (Math.random() - 0.5) * 30));
      const pos = { x: cx, y: 0.2, z: -54.0 + (Math.random() - 0.5) * 6 };
      const sp = this.createSpatialOneShotOut(pos, 16, 1.05, true);
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(142 + Math.random() * 25, now);
      osc.frequency.linearRampToValueAtTime(184 + Math.random() * 20, now + 0.19);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 345;
      bp.Q.value = 3.1;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.055, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      osc.connect(bp);
      bp.connect(g);
      g.connect(sp.dest);
      this.disconnectOnEnded(osc, osc, bp, g, ...sp.cleanup);
      osc.start(now);
      osc.stop(now + 0.27);
    } else {
      // 5. SE Farmers' Market wooden crate tap / striped canvas awning breeze flap
      const pos = {
        x: 44.0 + (Math.random() - 0.5) * 18,
        y: 4.5 + Math.random() * 5,
        z: -46.0 + (Math.random() - 0.5) * 18,
      };
      const sp = this.createSpatialOneShotOut(pos, 16, 1.05, true);
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      const f = 195 + Math.random() * 90;
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.55, now + 0.075);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.068, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      osc.connect(g);
      g.connect(sp.dest);
      this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  }

  private triggerAmbientCanopyBird(): void {
    if (!this.ctx || !this.sfxGain) return;
    const pool = this.isIndoors ? ATELIER_OUTSIDE_BIRD_PERCHES : OUTDOOR_CANOPY_PERCHES;
    let chosen = pool[Math.floor(Math.random() * pool.length)];
    if (!this.isIndoors && Math.random() < 0.55) {
      let bestD = Infinity;
      for (let k = 0; k < 3; k++) {
        const cand = pool[Math.floor(Math.random() * pool.length)];
        const d = Math.hypot(cand.x - this.birdPos.x, cand.z - this.birdPos.z);
        if (d > 14 && d < bestD) {
          bestD = d;
          chosen = cand;
        }
      }
    }
    if (this.ambientSpeciesBag.length === 0) {
      this.ambientSpeciesBag = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      for (let k = this.ambientSpeciesBag.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        const tmp = this.ambientSpeciesBag[k];
        this.ambientSpeciesBag[k] = this.ambientSpeciesBag[j];
        this.ambientSpeciesBag[j] = tmp;
      }
      if (this.ambientSpeciesBag[this.ambientSpeciesBag.length - 1] === this.lastAmbientSpecies) {
        const last = this.ambientSpeciesBag.length - 1;
        const tmp = this.ambientSpeciesBag[last];
        this.ambientSpeciesBag[last] = this.ambientSpeciesBag[0];
        this.ambientSpeciesBag[0] = tmp;
      }
    }
    const seed = this.ambientSpeciesBag.pop()!;
    this.lastAmbientSpecies = seed;
    this.playCompanionChirp(seed, chosen, true, true, false);
  }

  public triggerGuitarPluck(freq: number, volume = 0.14, worldPos?: Vec3Like): void {
    if (!worldPos) {
      this.triggerPluckedHarpNote(freq, volume * 0.85, 0);
      return;
    }
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    if (
      this.buskerBodyEq &&
      Math.hypot(worldPos.x - 33.5, worldPos.z - 39.5) < 8.0
    ) {
      this.triggerBuskerString(freq, volume * 1.25, now, 1.18, 'strum');
      return;
    }
    const buf = this.getOrCreateGuitarStringBuffer(freq, 'finger');
    if (!buf) return;
    const sp = this.createSpatialOneShotOut(worldPos, 5.5, 2.2, true);
    const quantizedHz = Math.round(Math.max(72, Math.min(880, freq)) * 2.0) * 0.5;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(freq / quantizedHz, now);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume * 1.15, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + buf.duration - 0.02);
    src.connect(g);
    g.connect(sp.dest);
    this.disconnectOnEnded(src, src, g, ...sp.cleanup);
    src.start(now);
  }

  public triggerCelestaBell(freq: number, volume = 0.07): void {
    // Warm wooden marimba + gentle harmonic
    const warmFreq = freq > 720 ? freq * 0.5 : freq;
    this.triggerMarimbaNote(warmFreq, volume * 0.82, 0);
    this.triggerVibraphoneNote(warmFreq * 1.5, volume * 0.35, 1.35);
  }

  // ==========================================================================
  // Expressive Bird Chirps (PC Sparrow + 12 Songbird Species + Spatial Pigeons)
  // ==========================================================================

  private triggerSyrinxSyllable(opts: {
    t0: number;
    dur: number;
    fStart: number;
    fPeak: number;
    fEnd: number;
    peakRatio?: number;
    voice2Ratio?: number;
    voice2Mix?: number;
    trillHz?: number;
    trillDepth?: number;
    gain: number;
    destNode?: AudioNode;
    extraCleanup?: AudioNode[];
  }): void {
    if (!this.ctx || !this.sfxGain) return;
    const {
      t0,
      dur,
      fStart,
      fPeak,
      fEnd,
      peakRatio = 0.34,
      voice2Ratio = 1.335,
      voice2Mix = 0.36,
      trillHz = 0,
      trillDepth = 0,
      gain,
      destNode,
      extraCleanup = [],
    } = opts;

    const tPeak = t0 + dur * peakRatio;
    const tEnd = t0 + dur;

    const formant = this.ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.setValueAtTime(Math.min(5800, fPeak * 1.08), t0);
    formant.Q.value = 1.85;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.18));
    env.gain.setValueAtTime(gain * 0.88, t0 + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, tEnd);

    const oscA = this.ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.setValueAtTime(fStart, t0);
    oscA.frequency.exponentialRampToValueAtTime(fPeak, tPeak);
    oscA.frequency.exponentialRampToValueAtTime(fEnd, tEnd);

    const oscB = this.ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.setValueAtTime(fStart * voice2Ratio, t0);
    oscB.frequency.exponentialRampToValueAtTime(fPeak * voice2Ratio, tPeak);
    oscB.frequency.exponentialRampToValueAtTime(fEnd * voice2Ratio, tEnd);

    const mixB = this.ctx.createGain();
    mixB.gain.value = voice2Mix;

    if (trillHz > 0 && trillDepth > 0) {
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(trillHz, t0);
      const lfoGainA = this.ctx.createGain();
      lfoGainA.gain.value = trillDepth;
      const lfoGainB = this.ctx.createGain();
      lfoGainB.gain.value = trillDepth * voice2Ratio;
      lfo.connect(lfoGainA);
      lfo.connect(lfoGainB);
      lfoGainA.connect(oscA.frequency);
      lfoGainB.connect(oscB.frequency);
      this.disconnectOnEnded(lfo, lfo, lfoGainA, lfoGainB);
      lfo.start(t0);
      lfo.stop(tEnd + 0.01);
    }

    if (this.chiffBuf) {
      const chiff = this.ctx.createBufferSource();
      chiff.buffer = this.chiffBuf;
      const chiffGain = this.ctx.createGain();
      chiffGain.gain.value = gain * 0.32;
      chiff.connect(chiffGain);
      chiffGain.connect(formant);
      this.disconnectOnEnded(chiff, chiff, chiffGain);
      chiff.start(t0);
    }

    oscA.connect(formant);
    oscB.connect(mixB);
    mixB.connect(formant);
    formant.connect(env);
    env.connect(destNode ?? this.sfxGain);

    let send: GainNode | null = null;
    if (!destNode && this.reverbNode) {
      send = this.ctx.createGain();
      send.gain.value = 0.14;
      env.connect(send);
      send.connect(this.reverbNode);
    }

    this.disconnectOnEnded(oscB, oscB, mixB);
    if (send) {
      this.disconnectOnEnded(oscA, oscA, formant, env, send, ...extraCleanup);
    } else {
      this.disconnectOnEnded(oscA, oscA, formant, env, ...extraCleanup);
    }

    oscA.start(t0);
    oscB.start(t0);
    oscB.stop(tEnd + 0.011);
    oscA.stop(tEnd + 0.014);
  }

  public playSparrowChirp(melodicTrill = false, startTime?: number): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;

    const cell = MODAL_CELLS[this.modalIndex];
    const scaleNote = cell.malletScale[Math.floor(Math.random() * 5) + 4];
    const rootHz = Math.max(2400, Math.min(3600, scaleNote * 3.15));
    const baseTime =
      startTime !== undefined ? Math.max(this.ctx.currentTime, startTime) : this.ctx.currentTime;
    const jitter = 0.95 + Math.random() * 0.1;

    if (melodicTrill) {
      const trillStyle = Math.floor(Math.random() * 3);
      if (trillStyle === 0) {
        // 3-syllable House Sparrow song phrase ("cheep - ti-ti - chirrup")
        this.triggerSyrinxSyllable({
          t0: baseTime,
          dur: 0.082,
          fStart: rootHz * 0.84 * jitter,
          fPeak: rootHz * 1.26 * jitter,
          fEnd: rootHz * 0.92 * jitter,
          voice2Ratio: 1.33,
          voice2Mix: 0.34,
          gain: 0.145,
        });
        this.triggerSyrinxSyllable({
          t0: baseTime + 0.098,
          dur: 0.056,
          fStart: rootHz * 1.12 * jitter,
          fPeak: rootHz * 1.42 * jitter,
          fEnd: rootHz * 1.08 * jitter,
          voice2Ratio: 1.25,
          voice2Mix: 0.28,
          gain: 0.115,
        });
        this.triggerSyrinxSyllable({
          t0: baseTime + 0.168,
          dur: 0.125,
          fStart: rootHz * 1.18 * jitter,
          fPeak: rootHz * 1.34 * jitter,
          fEnd: rootHz * 0.78 * jitter,
          peakRatio: 0.28,
          voice2Ratio: 1.34,
          voice2Mix: 0.38,
          trillHz: 46,
          trillDepth: 135,
          gain: 0.14,
        });
      } else if (trillStyle === 1) {
        // Joyous 4-note soaring cascade ("ti-ti-swee-chirr")
        const ratios = [0.92, 1.08, 1.28, 1.14];
        ratios.forEach((r, idx) => {
          this.triggerSyrinxSyllable({
            t0: baseTime + idx * 0.068,
            dur: idx === 3 ? 0.11 : 0.054,
            fStart: rootHz * r * 0.88 * jitter,
            fPeak: rootHz * r * 1.22 * jitter,
            fEnd: rootHz * r * (idx === 3 ? 0.76 : 1.02) * jitter,
            trillHz: idx >= 2 ? 48 : 0,
            trillDepth: idx >= 2 ? 115 : 0,
            gain: 0.128,
          });
        });
      } else {
        // Liquid double-warble flight call
        this.triggerSyrinxSyllable({
          t0: baseTime,
          dur: 0.095,
          fStart: rootHz * 0.78 * jitter,
          fPeak: rootHz * 1.32 * jitter,
          fEnd: rootHz * 1.05 * jitter,
          trillHz: 42,
          trillDepth: 95,
          gain: 0.138,
        });
        this.triggerSyrinxSyllable({
          t0: baseTime + 0.108,
          dur: 0.118,
          fStart: rootHz * 1.04 * jitter,
          fPeak: rootHz * 1.44 * jitter,
          fEnd: rootHz * 0.84 * jitter,
          trillHz: 52,
          trillDepth: 130,
          gain: 0.135,
        });
      }
      return;
    }

    const variant = Math.floor(Math.random() * 5);
    if (variant === 0) {
      this.triggerSyrinxSyllable({
        t0: baseTime,
        dur: 0.078,
        fStart: rootHz * 0.82 * jitter,
        fPeak: rootHz * 1.28 * jitter,
        fEnd: rootHz * 0.88 * jitter,
        gain: 0.142,
      });
      this.triggerSyrinxSyllable({
        t0: baseTime + 0.094,
        dur: 0.105,
        fStart: rootHz * 1.05 * jitter,
        fPeak: rootHz * 1.22 * jitter,
        fEnd: rootHz * 0.74 * jitter,
        peakRatio: 0.25,
        trillHz: 44,
        trillDepth: 115,
        gain: 0.125,
      });
    } else if (variant === 1) {
      this.triggerSyrinxSyllable({
        t0: baseTime,
        dur: 0.092,
        fStart: rootHz * 0.76 * jitter,
        fPeak: rootHz * 1.36 * jitter,
        fEnd: rootHz * 1.06 * jitter,
        peakRatio: 0.58,
        trillHz: 38,
        trillDepth: 75,
        gain: 0.142,
      });
    } else if (variant === 2) {
      this.triggerSyrinxSyllable({
        t0: baseTime,
        dur: 0.112,
        fStart: rootHz * 0.92 * jitter,
        fPeak: rootHz * 1.32 * jitter,
        fEnd: rootHz * 0.82 * jitter,
        peakRatio: 0.38,
        trillHz: 50,
        trillDepth: 140,
        gain: 0.138,
      });
    } else if (variant === 3) {
      // Crisp 3-note passerine chatter ("chip-chip-cheep")
      for (let k = 0; k < 3; k++) {
        this.triggerSyrinxSyllable({
          t0: baseTime + k * 0.062,
          dur: k === 2 ? 0.088 : 0.046,
          fStart: rootHz * (0.85 + k * 0.08) * jitter,
          fPeak: rootHz * (1.18 + k * 0.09) * jitter,
          fEnd: rootHz * (k === 2 ? 0.82 : 0.96) * jitter,
          trillHz: k === 2 ? 42 : 0,
          trillDepth: k === 2 ? 95 : 0,
          gain: 0.122,
        });
      }
    } else {
      // Playful upward-downward double chirp ("tweet-chirrup")
      this.triggerSyrinxSyllable({
        t0: baseTime,
        dur: 0.064,
        fStart: rootHz * 0.9 * jitter,
        fPeak: rootHz * 1.38 * jitter,
        fEnd: rootHz * 1.18 * jitter,
        gain: 0.132,
      });
      this.triggerSyrinxSyllable({
        t0: baseTime + 0.078,
        dur: 0.092,
        fStart: rootHz * 1.14 * jitter,
        fPeak: rootHz * 1.26 * jitter,
        fEnd: rootHz * 0.78 * jitter,
        trillHz: 46,
        trillDepth: 105,
        gain: 0.128,
      });
    }
  }

  /**
   * Spontaneous, softer expressive vocalizations from the PC sparrow during takeoff,
   * perching, idle curiosity, hopping, and mischievous capers.
   */
  public playSparrowMicroChirp(mood: MicroChirpMood = 'idle'): void {
    if (!this.ctx || !this.sfxGain) return;
    const cell = MODAL_CELLS[this.modalIndex];
    const scaleNote = cell.malletScale[Math.floor(Math.random() * 5) + 4];
    const rootHz = Math.max(2500, Math.min(3650, scaleNote * 3.2));
    const now = this.ctx.currentTime;
    const jitter = 0.95 + Math.random() * 0.1;

    if (mood === 'mischief') {
      // Cheeky 3-syllable caper laugh ("chi-chi-cheep")
      for (let i = 0; i < 3; i++) {
        this.triggerSyrinxSyllable({
          t0: now + i * 0.056,
          dur: i === 2 ? 0.082 : 0.044,
          fStart: rootHz * (0.9 + i * 0.1) * jitter,
          fPeak: rootHz * (1.24 + i * 0.1) * jitter,
          fEnd: rootHz * (i === 2 ? 0.86 : 1.04) * jitter,
          trillHz: i === 2 ? 52 : 0,
          trillDepth: i === 2 ? 120 : 0,
          gain: 0.105,
        });
      }
    } else if (mood === 'takeoff') {
      // Buoyant upward double peep ("pip-whee")
      this.triggerSyrinxSyllable({
        t0: now,
        dur: 0.045,
        fStart: rootHz * 0.86 * jitter,
        fPeak: rootHz * 1.18 * jitter,
        fEnd: rootHz * 1.04 * jitter,
        gain: 0.085,
      });
      this.triggerSyrinxSyllable({
        t0: now + 0.055,
        dur: 0.068,
        fStart: rootHz * 1.04 * jitter,
        fPeak: rootHz * 1.38 * jitter,
        fEnd: rootHz * 1.16 * jitter,
        peakRatio: 0.65,
        gain: 0.092,
      });
    } else if (mood === 'perch') {
      // Cozy settling "chirrup~"
      this.triggerSyrinxSyllable({
        t0: now + 0.02,
        dur: 0.085,
        fStart: rootHz * 1.06 * jitter,
        fPeak: rootHz * 1.22 * jitter,
        fEnd: rootHz * 0.78 * jitter,
        trillHz: 40,
        trillDepth: 85,
        gain: 0.082,
      });
    } else if (mood === 'hop') {
      // Tiny feather-light "pip"
      this.triggerSyrinxSyllable({
        t0: now,
        dur: 0.042,
        fStart: rootHz * 0.92 * jitter,
        fPeak: rootHz * 1.24 * jitter,
        fEnd: rootHz * 0.98 * jitter,
        gain: 0.068,
      });
    } else {
      // Curious idle "chissip?" or soft warble
      this.triggerSyrinxSyllable({
        t0: now,
        dur: 0.076,
        fStart: rootHz * 0.8 * jitter,
        fPeak: rootHz * 1.28 * jitter,
        fEnd: rootHz * (Math.random() < 0.5 ? 1.08 : 0.84) * jitter,
        peakRatio: 0.52,
        trillHz: 36,
        trillDepth: 65,
        gain: 0.078,
      });
    }
  }

  public playCompanionChirp(
    voiceSeed = 0,
    worldPos?: Vec3Like,
    routeOutdoorMuffle = false,
    isAmbientCanopy = false,
    isPlayerEcho = false
  ): boolean {
    if (!this.ctx || !this.sfxGain) return false;
    const now = this.ctx.currentTime;
    if (!isPlayerEcho) {
      const minGap = isAmbientCanopy ? 5.2 : 4.5;
      if (
        this.ambientClock - this.lastAmbientChirpAt < minGap ||
        this.ambientClock - this.lastPigeonCooAt < 2.2
      ) {
        return false;
      }
      this.lastAmbientChirpAt = this.ambientClock;
    }

    const cell = MODAL_CELLS[this.modalIndex];
    const pitchJitter = 0.86 + Math.random() * 0.28;
    const tempoJitter = 0.84 + Math.random() * 0.34;
    const scaleOffset = Math.floor(Math.random() * cell.malletScale.length);
    const scaleIdx = (Math.abs(voiceSeed) * 2 + scaleOffset) % cell.malletScale.length;
    const f1 = Math.max(2050, cell.malletScale[scaleIdx] * 2.95) * pitchJitter;
    const f2 =
      Math.max(2320, cell.malletScale[(scaleIdx + 2) % cell.malletScale.length] * 3.05) *
      pitchJitter;

    const speciesStyle = Math.abs(voiceSeed) % 12;
    const sp = this.createSpatialOneShotOut(
      worldPos,
      isAmbientCanopy ? 15 : 17,
      isAmbientCanopy ? 1.08 : 0.96,
      routeOutdoorMuffle
    );
    const baseGain =
      (isAmbientCanopy ? 0.072 : worldPos ? 0.104 : 0.082) * (0.85 + Math.random() * 0.26);

    if (speciesStyle === 0) {
      // 1. European Robin liquid silver warble (2 or 3 slurred notes)
      const count = Math.random() < 0.45 ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const up = k % 2 === 0;
        this.triggerSyrinxSyllable({
          t0: now + k * 0.118 * tempoJitter,
          dur: (0.095 + Math.random() * 0.035) * tempoJitter,
          fStart: (up ? f1 * 0.86 : f2 * 0.96) * (0.96 + Math.random() * 0.08),
          fPeak: (up ? f2 * 1.12 : f2 * 1.22),
          fEnd: (up ? f1 * 0.94 : f1 * 0.82),
          voice2Ratio: 1.5,
          voice2Mix: 0.22,
          trillHz: 28 + Math.random() * 10,
          trillDepth: 70 + Math.random() * 25,
          gain: baseGain * (1 - k * 0.06),
          destNode: sp.dest,
          extraCleanup: k === count - 1 ? sp.cleanup : [],
        });
      }
    } else if (speciesStyle === 1) {
      // 2. Blue Tit crystalline bell ("tsee-tsee-tsuh")
      const count = 2 + Math.floor(Math.random() * 2);
      for (let k = 0; k < count; k++) {
        const isLast = k === count - 1;
        const fk = !isLast ? f2 * 1.15 : f1 * 0.92;
        this.triggerSyrinxSyllable({
          t0: now + k * 0.078 * tempoJitter,
          dur: (!isLast ? 0.052 : 0.098) * tempoJitter,
          fStart: fk * 0.95,
          fPeak: fk * 1.1,
          fEnd: fk * (!isLast ? 1.02 : 0.78),
          voice2Ratio: 1.25,
          voice2Mix: 0.2,
          trillHz: isLast ? 48 + Math.random() * 12 : 0,
          trillDepth: isLast ? 95 : 0,
          gain: baseGain * 0.86,
          destNode: sp.dest,
          extraCleanup: isLast ? sp.cleanup : [],
        });
      }
    } else if (speciesStyle === 2) {
      // 3. European Goldfinch buoyant liquid phrase
      const notes =
        Math.random() < 0.5
          ? [f1 * 0.9, f1 * 1.06, f2 * 1.12]
          : [f1 * 1.04, f2 * 0.92, f1 * 0.88, f2 * 1.08];
      notes.forEach((f, idx) => {
        this.triggerSyrinxSyllable({
          t0: now + idx * 0.084 * tempoJitter,
          dur: 0.066 * tempoJitter,
          fStart: f * 0.86,
          fPeak: f * 1.16,
          fEnd: f * 0.97,
          voice2Ratio: 1.33,
          voice2Mix: 0.26,
          trillHz: 38 + Math.random() * 10,
          trillDepth: 62,
          gain: baseGain * 0.88,
          destNode: sp.dest,
          extraCleanup: idx === notes.length - 1 ? sp.cleanup : [],
        });
      });
    } else if (speciesStyle === 3) {
      // 4. Common Blackbird mellow low-register flute phrase
      const bf = (1220 + Math.random() * 380) * pitchJitter;
      const mults = Math.random() < 0.5 ? [1.0, 1.24, 1.1] : [1.18, 0.96, 1.12];
      mults.forEach((mult, idx) => {
        const isLast = idx === mults.length - 1;
        this.triggerSyrinxSyllable({
          t0: now + idx * 0.135 * tempoJitter,
          dur: 0.118 * tempoJitter,
          fStart: bf * mult * 0.94,
          fPeak: bf * mult * 1.07,
          fEnd: bf * mult * (isLast ? 0.87 : 1.02),
          voice2Ratio: 2.0,
          voice2Mix: 0.15,
          trillHz: isLast ? 21 : 0,
          trillDepth: isLast ? 36 : 0,
          gain: baseGain * 1.02,
          destNode: sp.dest,
          extraCleanup: isLast ? sp.cleanup : [],
        });
      });
    } else if (speciesStyle === 4) {
      // 5. Chaffinch lively descending cascade
      const steps = 3 + Math.floor(Math.random() * 2);
      for (let k = 0; k < steps; k++) {
        const isLast = k === steps - 1;
        const fk = f2 * (1.14 - k * 0.085);
        this.triggerSyrinxSyllable({
          t0: now + k * 0.064 * tempoJitter,
          dur: (isLast ? 0.095 : 0.048) * tempoJitter,
          fStart: fk * 1.04,
          fPeak: fk * 1.14,
          fEnd: fk * (isLast ? 0.78 : 0.92),
          trillHz: isLast ? 44 : 0,
          trillDepth: isLast ? 82 : 0,
          gain: baseGain * 0.86,
          destNode: sp.dest,
          extraCleanup: isLast ? sp.cleanup : [],
        });
      }
    } else if (speciesStyle === 5) {
      // 6. Eurasian Wren soft sparkling rapid trill
      const count = 3 + Math.floor(Math.random() * 2);
      for (let k = 0; k < count; k++) {
        const isLast = k === count - 1;
        const fk = (k % 2 === 0 ? f1 : f2) * 1.03;
        this.triggerSyrinxSyllable({
          t0: now + k * 0.056 * tempoJitter,
          dur: 0.046 * tempoJitter,
          fStart: fk * 0.9,
          fPeak: fk * 1.16,
          fEnd: fk * 0.94,
          trillHz: 50,
          trillDepth: 95,
          gain: baseGain * 0.8,
          destNode: sp.dest,
          extraCleanup: isLast ? sp.cleanup : [],
        });
      }
    } else if (speciesStyle === 6) {
      // 7. Common Chiffchaff gentle alternating two-note drop ("chiff-chaff")
      const hi = (2550 + Math.random() * 340) * pitchJitter;
      const lo = hi * (0.81 + Math.random() * 0.04);
      const seq = Math.random() < 0.5 ? [hi, lo] : [hi, lo, hi * 0.98];
      seq.forEach((f, idx) => {
        const isLast = idx === seq.length - 1;
        this.triggerSyrinxSyllable({
          t0: now + idx * 0.21 * tempoJitter,
          dur: 0.072 * tempoJitter,
          fStart: f * 1.06,
          fPeak: f * 1.1,
          fEnd: f * 0.84,
          voice2Ratio: 1.5,
          voice2Mix: 0.14,
          gain: baseGain * 0.86,
          destNode: sp.dest,
          extraCleanup: isLast ? sp.cleanup : [],
        });
      });
    } else if (speciesStyle === 7) {
      // 8. Great Tit clear two-tone bell ("teach-er, teach-er")
      const hi = (2280 + Math.random() * 260) * pitchJitter;
      const lo = hi * 0.79;
      const pairs = Math.random() < 0.5 ? 1 : 2;
      const total = pairs * 2;
      for (let k = 0; k < total; k++) {
        const isLast = k === total - 1;
        const f = k % 2 === 0 ? hi : lo;
        this.triggerSyrinxSyllable({
          t0: now + k * 0.125 * tempoJitter,
          dur: (k % 2 === 0 ? 0.082 : 0.095) * tempoJitter,
          fStart: f * 0.98,
          fPeak: f * 1.03,
          fEnd: f * 0.94,
          voice2Ratio: 2.0,
          voice2Mix: 0.16,
          gain: baseGain * 0.9,
          destNode: sp.dest,
          extraCleanup: isLast ? sp.cleanup : [],
        });
      }
    } else if (speciesStyle === 8) {
      // 9. Eurasian Collared Dove soft warm distant three-note whistle ("coo-COO-coo")
      const root = (540 + Math.random() * 95) * pitchJitter;
      const notes = [
        { dt: 0.0, dur: 0.14, f0: root * 0.96, f1: root * 1.04, f2: root * 0.95, g: 0.72 },
        { dt: 0.19, dur: 0.26, f0: root * 1.05, f1: root * 1.22, f2: root * 1.02, g: 1.0 },
        { dt: 0.50, dur: 0.19, f0: root * 0.96, f1: root * 0.98, f2: root * 0.86, g: 0.68 },
      ];
      notes.forEach((n, idx) => {
        const isLast = idx === notes.length - 1;
        this.triggerSyrinxSyllable({
          t0: now + n.dt * tempoJitter,
          dur: n.dur * tempoJitter,
          fStart: n.f0,
          fPeak: n.f1,
          fEnd: n.f2,
          voice2Ratio: 2.0,
          voice2Mix: 0.08,
          trillHz: 16,
          trillDepth: 9,
          gain: baseGain * 0.88 * n.g,
          destNode: sp.dest,
          extraCleanup: isLast ? sp.cleanup : [],
        });
      });
    } else if (speciesStyle === 9) {
      // 10. Black Redstart sweet upward-inflected plaintive whistle ("huit-tek")
      const fBase = (2180 + Math.random() * 360) * pitchJitter;
      const addClick = Math.random() < 0.6;
      this.triggerSyrinxSyllable({
        t0: now,
        dur: 0.125 * tempoJitter,
        fStart: fBase * 0.84,
        fPeak: fBase * 1.18,
        fEnd: fBase * 1.28,
        voice2Ratio: 1.5,
        voice2Mix: 0.14,
        gain: baseGain * 0.88,
        destNode: sp.dest,
        extraCleanup: addClick ? [] : sp.cleanup,
      });
      if (addClick) {
        this.triggerSyrinxSyllable({
          t0: now + 0.175 * tempoJitter,
          dur: 0.032 * tempoJitter,
          fStart: fBase * 0.95,
          fPeak: fBase * 0.72,
          fEnd: fBase * 0.58,
          gain: baseGain * 0.64,
          destNode: sp.dest,
          extraCleanup: sp.cleanup,
        });
      }
    } else if (speciesStyle === 10) {
      // 11. Barn Swallow airy soaring double-pip ("wit-wit")
      const fSwallow = (2650 + Math.random() * 420) * pitchJitter;
      for (let k = 0; k < 2; k++) {
        this.triggerSyrinxSyllable({
          t0: now + k * 0.082 * tempoJitter,
          dur: 0.052 * tempoJitter,
          fStart: fSwallow * (k === 0 ? 0.88 : 0.94),
          fPeak: fSwallow * (k === 0 ? 1.14 : 1.22),
          fEnd: fSwallow * 0.96,
          voice2Ratio: 1.35,
          voice2Mix: 0.22,
          trillHz: 34,
          trillDepth: 48,
          gain: baseGain * 0.82,
          destNode: sp.dest,
          extraCleanup: k === 1 ? sp.cleanup : [],
        });
      }
    } else {
      // 12. Eurasian Nuthatch clear mellow whistle ("dwip-dwip")
      const fNut = (1680 + Math.random() * 340) * pitchJitter;
      const reps = Math.random() < 0.55 ? 2 : 1;
      for (let k = 0; k < reps; k++) {
        const isLast = k === reps - 1;
        this.triggerSyrinxSyllable({
          t0: now + k * 0.165 * tempoJitter,
          dur: 0.088 * tempoJitter,
          fStart: fNut * 0.92,
          fPeak: fNut * 1.14,
          fEnd: fNut * 0.86,
          voice2Ratio: 2.0,
          voice2Mix: 0.18,
          gain: baseGain * 0.9,
          destNode: sp.dest,
          extraCleanup: isLast ? sp.cleanup : [],
        });
      }
    }
    return true;
  }

  /**
   * Warm throat-rolled spatialized pigeon coo ("roo-c'too-coo~") for foraging park pigeons.
   */
  public playPigeonCoo(worldPos?: Vec3Like): boolean {
    if (!this.ctx || !this.sfxGain) return false;
    if (
      this.ambientClock - this.lastPigeonCooAt < 14.0 ||
      this.ambientClock - this.lastAmbientChirpAt < 2.4
    ) {
      return false;
    }
    this.lastPigeonCooAt = this.ambientClock;

    const now = this.ctx.currentTime;
    const pitchMul = 0.86 + Math.random() * 0.28;
    const tempoMul = 0.88 + Math.random() * 0.28;
    const sp = this.createSpatialOneShotOut(worldPos, 11, 1.25, true);
    const notes =
      Math.random() < 0.45
        ? [
            { dt: 0.0, dur: 0.15, f0: 345, f1: 415, f2: 338, amp: 0.056 },
            { dt: 0.20, dur: 0.25, f0: 418, f1: 440, f2: 325, amp: 0.062 },
          ]
        : [
            { dt: 0.0, dur: 0.16, f0: 360, f1: 430, f2: 350, amp: 0.058 },
            { dt: 0.19, dur: 0.09, f0: 410, f1: 465, f2: 390, amp: 0.048 },
            { dt: 0.31, dur: 0.28, f0: 435, f1: 455, f2: 335, amp: 0.064 },
          ];
    notes.forEach((n, idx) => {
      const dur = n.dur * tempoMul;
      const t0 = now + n.dt * tempoMul;
      const osc = this.ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.f0 * pitchMul, t0);
      osc.frequency.linearRampToValueAtTime(n.f1 * pitchMul, t0 + dur * 0.35);
      osc.frequency.exponentialRampToValueAtTime(n.f2 * pitchMul, t0 + dur);

      const lfo = this.ctx!.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 17.5 + Math.random() * 4.5;
      const lfoG = this.ctx!.createGain();
      lfoG.gain.value = 14 + Math.random() * 6;
      lfo.connect(lfoG);
      lfoG.connect(osc.frequency);

      const env = this.ctx!.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(n.amp, t0 + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(env);
      env.connect(sp.dest);
      this.disconnectOnEnded(lfo, lfo, lfoG);
      if (idx === notes.length - 1) {
        this.disconnectOnEnded(osc, osc, env, ...sp.cleanup);
      } else {
        this.disconnectOnEnded(osc, osc, env);
      }
      osc.start(t0);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.01);
      osc.stop(t0 + dur + 0.015);
    });
    return true;
  }

  public playPeckTap(
    surface: SurfaceSoundType | 'ceramic' | 'human' = 'wood',
    worldPos?: Vec3Like
  ): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 12, 1.0, false);
    const baseF =
      surface === 'metal'
        ? 1880
        : surface === 'ceramic'
          ? 2240
          : surface === 'stone'
            ? 1420
            : surface === 'human'
              ? 420
              : surface === 'fabric'
                ? 360
                : 890;

    const osc = this.ctx.createOscillator();
    osc.type = surface === 'ceramic' || surface === 'metal' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(baseF * (0.95 + Math.random() * 0.1), now);
    osc.frequency.exponentialRampToValueAtTime(baseF * 0.48, now + 0.032);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.135, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

    osc.connect(g);
    g.connect(sp.dest);
    this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
    osc.start(now);
    osc.stop(now + 0.042);
  }

  public playCeramicShatter(worldPos?: Vec3Like): void {
    this.unlock();
    this.addChaosImpulse(0.75);
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 16, 1.0, false);

    // 1. Hollow ceramic shell crack transient
    const crack = this.ctx.createOscillator();
    crack.type = 'triangle';
    crack.frequency.setValueAtTime(640, now);
    crack.frequency.exponentialRampToValueAtTime(165, now + 0.055);
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.19, now);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    crack.connect(cg);
    cg.connect(sp.dest);
    this.disconnectOnEnded(crack, crack, cg);
    crack.start(now);
    crack.stop(now + 0.07);

    // 2. Cascading glazed porcelain shard pings
    const shardFreqs = [1680, 2340, 2980, 3560, 4280, 5120, 2760];
    for (let i = 0; i < shardFreqs.length; i++) {
      const t0 = now + i * 0.018 + Math.random() * 0.015;
      const f = shardFreqs[i] * (0.93 + Math.random() * 0.14);
      const dur = 0.08 + Math.random() * 0.11;
      const o1 = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      o1.type = 'sine';
      o2.type = 'sine';
      o1.frequency.setValueAtTime(f, t0);
      o2.frequency.setValueAtTime(f * 1.618, t0);

      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(0.085 * (1 - i * 0.09), t0);
      sg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o1.connect(sg);
      o2.connect(sg);
      sg.connect(sp.dest);
      this.disconnectOnEnded(o2, o2);
      if (i === shardFreqs.length - 1) {
        this.disconnectOnEnded(o1, o1, sg, ...sp.cleanup);
      } else {
        this.disconnectOnEnded(o1, o1, sg);
      }
      o1.start(t0);
      o2.start(t0);
      o2.stop(t0 + dur + 0.01);
      o1.stop(t0 + dur + 0.014);
    }
  }

  public playPulleyCreak(progress = 0.5): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const pitchLift = 1.0 + progress * 0.45;

    const wheel = this.ctx.createOscillator();
    wheel.type = 'sawtooth';
    wheel.frequency.setValueAtTime(380 * pitchLift, now);
    wheel.frequency.exponentialRampToValueAtTime(540 * pitchLift, now + 0.12);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1180 * pitchLift;
    bp.Q.value = 5.0;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.075, now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    wheel.connect(bp);
    bp.connect(g);
    g.connect(this.sfxGain);
    this.disconnectOnEnded(wheel, wheel, bp, g);
    wheel.start(now);
    wheel.stop(now + 0.16);
  }

  private triggerHumanFormantSyllable(opts: {
    t0: number;
    dur: number;
    f0Start: number;
    f0Peak?: number;
    f0End: number;
    f1: number;
    f1End?: number;
    f2: number;
    f2End?: number;
    f3?: number;
    f3Gain?: number;
    q1?: number;
    q2?: number;
    breath?: number;
    gain: number;
    dest: AudioNode;
    cleanup?: AudioNode[];
  }): void {
    if (!this.ctx) return;
    const {
      t0,
      dur,
      f0Start,
      f0Peak,
      f0End,
      f1,
      f1End,
      f2,
      f2End,
      f3 = 2320,
      f3Gain = 0.065,
      q1 = 2.35,
      q2 = 2.85,
      breath = 0,
      gain,
      dest,
      cleanup = [],
    } = opts;
    const tMid = t0 + dur * 0.36;
    const tEnd = t0 + dur;
    const projectedGain = Math.min(0.48, gain * 2.35);

    const glottal = this.ctx.createOscillator();
    if (this.glottalWave) {
      glottal.setPeriodicWave(this.glottalWave);
    } else {
      glottal.type = 'triangle';
    }
    glottal.frequency.setValueAtTime(Math.max(65, f0Start), t0);
    if (f0Peak !== undefined) {
      glottal.frequency.exponentialRampToValueAtTime(Math.max(65, f0Peak), tMid);
    }
    glottal.frequency.exponentialRampToValueAtTime(Math.max(65, f0End), tEnd);

    // Subtle natural vocal-fold micro-vibrato on expressive sustained vowels
    let vibOsc: OscillatorNode | null = null;
    let vibGain: GainNode | null = null;
    if (dur >= 0.16) {
      vibOsc = this.ctx.createOscillator();
      vibOsc.type = 'sine';
      vibOsc.frequency.value = 5.2 + Math.random() * 0.7;
      vibGain = this.ctx.createGain();
      vibGain.gain.setValueAtTime(0.4, t0);
      vibGain.gain.linearRampToValueAtTime(2.3, t0 + dur * 0.65);
      vibOsc.connect(vibGain);
      vibGain.connect(glottal.frequency);
    }

    // Gentle pharyngeal chest warmth resonance (replaces harsh unfiltered sawtooth/sub-octave growl)
    const chestWarm = this.ctx.createBiquadFilter();
    chestWarm.type = 'bandpass';
    chestWarm.frequency.setValueAtTime(Math.max(175, f1 * 0.76), t0);
    chestWarm.Q.value = 1.15;
    const chestMix = this.ctx.createGain();
    chestMix.gain.value = 0.28;

    const form1 = this.ctx.createBiquadFilter();
    form1.type = 'bandpass';
    form1.frequency.setValueAtTime(f1, t0);
    if (f1End !== undefined) {
      form1.frequency.exponentialRampToValueAtTime(Math.max(180, f1End), tEnd);
    }
    form1.Q.value = q1;

    const form2 = this.ctx.createBiquadFilter();
    form2.type = 'bandpass';
    form2.frequency.setValueAtTime(f2, t0);
    if (f2End !== undefined) {
      form2.frequency.exponentialRampToValueAtTime(Math.max(450, f2End), tEnd);
    }
    form2.Q.value = q2;
    const f2Mix = this.ctx.createGain();
    f2Mix.gain.value = 0.56;

    const form3 = this.ctx.createBiquadFilter();
    form3.type = 'bandpass';
    form3.frequency.setValueAtTime(f3, t0);
    form3.Q.value = 2.9;
    const f3Mix = this.ctx.createGain();
    f3Mix.gain.value = f3Gain;

    // Soft lip/throat radiation warmth roll-off so upper partials stay silky and natural
    const throatLp = this.ctx.createBiquadFilter();
    throatLp.type = 'lowpass';
    throatLp.frequency.setValueAtTime(3150, t0);
    throatLp.Q.value = 0.55;

    const attack = Math.min(0.026, dur * 0.24);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(projectedGain, t0 + attack);
    env.gain.setValueAtTime(projectedGain * 0.86, t0 + dur * 0.58);
    env.gain.exponentialRampToValueAtTime(0.0001, tEnd);

    glottal.connect(chestWarm);
    glottal.connect(form1);
    glottal.connect(form2);
    glottal.connect(form3);
    chestWarm.connect(chestMix);
    chestMix.connect(throatLp);
    form1.connect(throatLp);
    form2.connect(f2Mix);
    f2Mix.connect(throatLp);
    form3.connect(f3Mix);
    f3Mix.connect(throatLp);
    throatLp.connect(env);
    env.connect(dest);

    if (breath > 0 && this.chiffBuf) {
      const bSrc = this.ctx.createBufferSource();
      bSrc.buffer = this.chiffBuf;
      bSrc.playbackRate.value = 0.88 + Math.random() * 0.16;
      const bBp = this.ctx.createBiquadFilter();
      bBp.type = 'bandpass';
      bBp.frequency.value = Math.min(2400, f2 * 1.05);
      bBp.Q.value = 1.35;
      const bGain = this.ctx.createGain();
      bGain.gain.setValueAtTime(Math.min(0.16, projectedGain * breath * 0.42), t0);
      bGain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(0.085, dur));
      bSrc.connect(bBp);
      bBp.connect(bGain);
      bGain.connect(dest);
      this.disconnectOnEnded(bSrc, bSrc, bBp, bGain);
      bSrc.start(t0);
    }

    if (vibOsc && vibGain) {
      this.disconnectOnEnded(vibOsc, vibOsc, vibGain);
    }
    this.disconnectOnEnded(
      glottal,
      glottal,
      chestWarm,
      chestMix,
      form1,
      form2,
      f2Mix,
      form3,
      f3Mix,
      throatLp,
      env,
      ...cleanup
    );
    glottal.start(t0);
    if (vibOsc) {
      vibOsc.start(t0);
      vibOsc.stop(tEnd + 0.015);
    }
    glottal.stop(tEnd + 0.02);
  }

  public playHumanYell(
    worldPos?: Vec3Like,
    voicePitch = 1.0,
    style: 'hey' | 'shoo' | 'oi' | 'chef' = 'hey'
  ): void {
    this.unlock();
    if (!this.ctx || !this.voiceGain) return;
    const sp = this.createLocalizedVoiceOut(worldPos, 27.0, 5.0);
    if (!sp) return;
    this.addChaosImpulse(0.36);
    const now = this.ctx.currentTime;
    const vp = Math.max(0.75, Math.min(1.42, voicePitch)) * (0.96 + Math.random() * 0.08);

    if (style === 'oi') {
      // Warm surprised "Oh-oi!"
      this.triggerHumanFormantSyllable({
        t0: now,
        dur: 0.19,
        f0Start: 188 * vp,
        f0Peak: 282 * vp,
        f0End: 218 * vp,
        f1: 480,
        f1End: 560,
        f2: 960,
        f2End: 1460,
        f3Gain: 0.08,
        breath: 0.25,
        gain: 0.135,
        dest: sp.dest,
        cleanup: sp.cleanup,
      });
      return;
    }

    if (style === 'shoo') {
      // Expressive two-part "Hoo-ey!"
      this.triggerHumanFormantSyllable({
        t0: now,
        dur: 0.11,
        f0Start: 205 * vp,
        f0Peak: 268 * vp,
        f0End: 228 * vp,
        f1: 370,
        f2: 880,
        f3Gain: 0.05,
        breath: 0.48,
        gain: 0.115,
        dest: sp.dest,
      });
      this.triggerHumanFormantSyllable({
        t0: now + 0.125,
        dur: 0.18,
        f0Start: 256 * vp,
        f0End: 176 * vp,
        f1: 540,
        f1End: 460,
        f2: 1580,
        f2End: 1280,
        f3Gain: 0.08,
        breath: 0.2,
        gain: 0.125,
        dest: sp.dest,
        cleanup: sp.cleanup,
      });
      return;
    }

    if (style === 'chef') {
      // Warm theatrical French baker "Eh! Oh-la!"
      this.triggerHumanFormantSyllable({
        t0: now,
        dur: 0.15,
        f0Start: 178 * vp,
        f0Peak: 268 * vp,
        f0End: 238 * vp,
        f1: 640,
        f1End: 560,
        f2: 1260,
        f2End: 1120,
        f3Gain: 0.09,
        breath: 0.24,
        gain: 0.145,
        dest: sp.dest,
      });
      this.triggerHumanFormantSyllable({
        t0: now + 0.165,
        dur: 0.22,
        f0Start: 248 * vp,
        f0End: 156 * vp,
        f1: 540,
        f1End: 440,
        f2: 960,
        f2End: 820,
        f3Gain: 0.07,
        breath: 0.18,
        gain: 0.138,
        dest: sp.dest,
        cleanup: sp.cleanup,
      });
      return;
    }

    // Default friendly-startled "Hey!"
    this.triggerHumanFormantSyllable({
      t0: now,
      dur: 0.2,
      f0Start: 204 * vp,
      f0Peak: 276 * vp,
      f0End: 186 * vp,
      f1: 520,
      f1End: 430,
      f2: 1680,
      f2End: 1420,
      f3Gain: 0.085,
      breath: 0.26,
      gain: 0.132,
      dest: sp.dest,
      cleanup: sp.cleanup,
    });
  }

  public playHumanGrunt(
    worldPos?: Vec3Like,
    voicePitch = 1.0,
    style: 'oof' | 'hmph' | 'ugh' | 'huh' = 'oof'
  ): void {
    this.unlock();
    if (!this.ctx || !this.voiceGain) return;
    const sp = this.createLocalizedVoiceOut(worldPos, 19.5, 4.0);
    if (!sp) return;
    const now = this.ctx.currentTime;
    const vp = Math.max(0.76, Math.min(1.42, voicePitch)) * (0.96 + Math.random() * 0.08);

    if (style === 'oof') {
      // Soft rounded surprised "Oh-uh!"
      this.triggerHumanFormantSyllable({
        t0: now,
        dur: 0.15,
        f0Start: 182 * vp,
        f0End: 132 * vp,
        f1: 440,
        f1End: 345,
        f2: 880,
        f2End: 710,
        f3Gain: 0.035,
        breath: 0.18,
        gain: 0.115,
        dest: sp.dest,
        cleanup: sp.cleanup,
      });
    } else if (style === 'hmph') {
      // Polite warm closed-lip "Mm-hm" murmur
      this.triggerHumanFormantSyllable({
        t0: now,
        dur: 0.085,
        f0Start: 162 * vp,
        f0End: 176 * vp,
        f1: 285,
        f2: 820,
        q1: 2.8,
        f3Gain: 0.015,
        breath: 0.08,
        gain: 0.092,
        dest: sp.dest,
      });
      this.triggerHumanFormantSyllable({
        t0: now + 0.092,
        dur: 0.135,
        f0Start: 184 * vp,
        f0End: 134 * vp,
        f1: 390,
        f1End: 320,
        f2: 960,
        f2End: 810,
        f3Gain: 0.03,
        breath: 0.16,
        gain: 0.105,
        dest: sp.dest,
        cleanup: sp.cleanup,
      });
    } else if (style === 'huh') {
      // Gentle curious upward "Hm?" / "Oh?"
      this.triggerHumanFormantSyllable({
        t0: now,
        dur: 0.16,
        f0Start: 158 * vp,
        f0Peak: 194 * vp,
        f0End: 238 * vp,
        f1: 420,
        f1End: 495,
        f2: 960,
        f2End: 1160,
        f3Gain: 0.045,
        breath: 0.18,
        gain: 0.104,
        dest: sp.dest,
        cleanup: sp.cleanup,
      });
    } else {
      // Soft warm sighing "Ah-uh..."
      this.triggerHumanFormantSyllable({
        t0: now,
        dur: 0.19,
        f0Start: 174 * vp,
        f0End: 128 * vp,
        f1: 515,
        f1End: 425,
        f2: 1080,
        f2End: 910,
        f3Gain: 0.04,
        breath: 0.24,
        gain: 0.108,
        dest: sp.dest,
        cleanup: sp.cleanup,
      });
    }
  }

  public playHumanChuckle(worldPos?: Vec3Like, voicePitch = 1.0): void {
    this.unlock();
    if (!this.ctx || !this.voiceGain) return;
    const sp = this.createLocalizedVoiceOut(worldPos, 19.5, 4.0);
    if (!sp) return;
    const now = this.ctx.currentTime;
    const vp = Math.max(0.78, Math.min(1.42, voicePitch)) * (0.96 + Math.random() * 0.08);
    const notes = [1.0, 1.11, 0.96];
    notes.forEach((mul, idx) => {
      this.triggerHumanFormantSyllable({
        t0: now + idx * 0.095,
        dur: 0.078,
        f0Start: 192 * vp * mul,
        f0End: 162 * vp * mul,
        f1: 540,
        f1End: 480,
        f2: 1240,
        f3Gain: 0.045,
        breath: 0.18,
        gain: 0.096 * (1 - idx * 0.14),
        dest: sp.dest,
        cleanup: idx === notes.length - 1 ? sp.cleanup : [],
      });
    });
  }

  public playHumanPetCoo(worldPos?: Vec3Like, voicePitch = 1.08): void {
    if (!this.ctx || !this.voiceGain) return;
    const sp = this.createLocalizedVoiceOut(worldPos, 18.5, 3.8);
    if (!sp) return;
    const now = this.ctx.currentTime;
    const vp = Math.max(0.8, Math.min(1.42, voicePitch));
    this.triggerHumanFormantSyllable({
      t0: now,
      dur: 0.27,
      f0Start: 218 * vp,
      f0Peak: 266 * vp,
      f0End: 194 * vp,
      f1: 440,
      f1End: 380,
      f2: 910,
      f2End: 820,
      f3Gain: 0.035,
      breath: 0.14,
      gain: 0.102,
      dest: sp.dest,
      cleanup: sp.cleanup,
    });

    if (sp.dist3D < 11.5) {
      const cell = MODAL_CELLS[this.modalIndex];
      this.triggerPluckedHarpNote(cell.malletScale[6], 0.06, 0);
    }
  }

  public playHumanShoo(worldPos?: Vec3Like, voicePitch = 1.0): void {
    if (!this.ctx || !this.voiceGain) return;
    this.playHumanYell(worldPos, voicePitch, 'shoo');
    if (
      !worldPos ||
      Math.hypot(
        worldPos.x - this.birdPos.x,
        worldPos.y - this.birdPos.y,
        worldPos.z - this.birdPos.z
      ) < 8.5
    ) {
      this.playFeatherRuffle(0.48);
    }
  }

  public playDroppingRelease(): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(590 * (0.95 + Math.random() * 0.1), now);
    osc.frequency.exponentialRampToValueAtTime(270, now + 0.036);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.046, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

    osc.connect(g);
    g.connect(this.sfxGain);
    this.disconnectOnEnded(osc, osc, g);
    osc.start(now);
    osc.stop(now + 0.044);
  }

  public playDroppingSplat(
    surface: 'surface' | 'human' | 'water' = 'surface',
    worldPos?: Vec3Like
  ): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    if (surface === 'water') {
      this.playWaterPlop(worldPos);
      return;
    }

    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 15, 1.0, false);
    const jitter = 0.93 + Math.random() * 0.14;

    // 1. Soft wet comic plop transient
    const plop = this.ctx.createOscillator();
    plop.type = 'triangle';
    plop.frequency.setValueAtTime((surface === 'human' ? 340 : 295) * jitter, now);
    plop.frequency.exponentialRampToValueAtTime(118 * jitter, now + 0.068);

    const pg = this.ctx.createGain();
    pg.gain.setValueAtTime(surface === 'human' ? 0.135 : 0.105, now);
    pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.078);
    plop.connect(pg);
    pg.connect(sp.dest);

    // 2. Tiny secondary bubble pop
    const pop = this.ctx.createOscillator();
    pop.type = 'sine';
    pop.frequency.setValueAtTime(480 * jitter, now + 0.024);
    pop.frequency.exponentialRampToValueAtTime(690 * jitter, now + 0.056);
    const popG = this.ctx.createGain();
    popG.gain.setValueAtTime(0.055, now + 0.024);
    popG.gain.exponentialRampToValueAtTime(0.0001, now + 0.064);
    pop.connect(popG);
    popG.connect(sp.dest);

    if (this.chiffBuf) {
      const squelch = this.ctx.createBufferSource();
      squelch.buffer = this.chiffBuf;
      squelch.playbackRate.value = 0.72 * jitter;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(980, now);
      bp.frequency.exponentialRampToValueAtTime(460, now + 0.065);
      bp.Q.value = 1.8;
      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(0.06, now);
      sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.072);
      squelch.connect(bp);
      bp.connect(sg);
      sg.connect(sp.dest);
      this.disconnectOnEnded(squelch, squelch, bp, sg);
      squelch.start(now);
    }

    this.disconnectOnEnded(plop, plop, pg);
    this.disconnectOnEnded(pop, pop, popG, ...sp.cleanup);
    plop.start(now);
    plop.stop(now + 0.082);
    pop.start(now + 0.024);
    pop.stop(now + 0.068);
  }

  public playHumanPoopedReaction(worldPos?: Vec3Like, voicePitch = 1.0): void {
    if (!this.ctx || !this.voiceGain) return;
    const sp = this.createLocalizedVoiceOut(worldPos, 27.0, 5.0);
    if (!sp) return;
    this.addChaosImpulse(0.36);
    const now = this.ctx.currentTime;
    const vp = Math.max(0.76, Math.min(1.4, voicePitch)) * (0.95 + Math.random() * 0.1);

    // Startled yelp -> dismayed groan -> soft grumble
    this.triggerHumanFormantSyllable({
      t0: now + 0.015,
      dur: 0.11,
      f0Start: 215 * vp,
      f0Peak: 345 * vp,
      f0End: 285 * vp,
      f1: 580,
      f2: 1580,
      f3Gain: 0.075,
      breath: 0.3,
      gain: 0.125,
      dest: sp.dest,
    });
    this.triggerHumanFormantSyllable({
      t0: now + 0.15,
      dur: 0.22,
      f0Start: 285 * vp,
      f0End: 156 * vp,
      f1: 520,
      f1End: 430,
      f2: 1080,
      f2End: 880,
      f3Gain: 0.055,
      breath: 0.2,
      gain: 0.12,
      dest: sp.dest,
    });
    this.triggerHumanFormantSyllable({
      t0: now + 0.41,
      dur: 0.17,
      f0Start: 185 * vp,
      f0End: 136 * vp,
      f1: 420,
      f1End: 350,
      f2: 920,
      f2End: 780,
      f3Gain: 0.035,
      breath: 0.16,
      gain: 0.102,
      dest: sp.dest,
      cleanup: sp.cleanup,
    });
  }

  public playTramBell(worldPos?: Vec3Like): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 24, 0.95, true);
    const strikes = [0, 0.155];
    strikes.forEach((dt, sIdx) => {
      const t0 = now + dt;
      // Crisp iron foot-clapper transient
      const clapper = this.ctx!.createOscillator();
      clapper.type = 'triangle';
      clapper.frequency.setValueAtTime(3400, t0);
      clapper.frequency.exponentialRampToValueAtTime(880, t0 + 0.014);
      const cg = this.ctx!.createGain();
      cg.gain.setValueAtTime(0.068, t0);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.018);
      clapper.connect(cg);
      cg.connect(sp.dest);
      this.disconnectOnEnded(clapper, clapper, cg);
      clapper.start(t0);
      clapper.stop(t0 + 0.02);

      // Rich cast-brass streetcar gong partials
      const partials = [
        { f: 1145, amp: 0.125, dur: 0.44 },
        { f: 2318, amp: 0.068, dur: 0.28 },
        { f: 3125, amp: 0.044, dur: 0.21 },
        { f: 4290, amp: 0.024, dur: 0.14 },
      ];
      partials.forEach((p, pIdx) => {
        const osc = this.ctx!.createOscillator();
        osc.type = pIdx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(p.f * (sIdx === 1 ? 1.014 : 1.0), t0);
        const g = this.ctx!.createGain();
        g.gain.setValueAtTime(p.amp * (sIdx === 1 ? 0.94 : 1.0), t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
        osc.connect(g);
        g.connect(sp.dest);
        if (sIdx === strikes.length - 1 && pIdx === 0) {
          this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
        } else {
          this.disconnectOnEnded(osc, osc, g);
        }
        osc.start(t0);
        osc.stop(t0 + p.dur + 0.02);
      });
    });
  }

  public playShutterCreak(worldPos?: Vec3Like): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 15, 1.0, false);
    const pitch = 0.92 + Math.random() * 0.16;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(195 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(285 * pitch, now + 0.13);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 690 * pitch;
    bp.Q.value = 4.2;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.072, now + 0.024);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(bp);
    bp.connect(g);
    g.connect(sp.dest);

    const tap = this.ctx.createOscillator();
    tap.type = 'triangle';
    tap.frequency.setValueAtTime(420 * pitch, now + 0.11);
    tap.frequency.exponentialRampToValueAtTime(160 * pitch, now + 0.155);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.055, now + 0.11);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    tap.connect(tg);
    tg.connect(sp.dest);

    this.disconnectOnEnded(tap, tap, tg);
    this.disconnectOnEnded(osc, osc, bp, g, ...sp.cleanup);
    osc.start(now);
    osc.stop(now + 0.17);
    tap.start(now + 0.11);
    tap.stop(now + 0.165);
  }

  public playWirePluck(worldPos?: Vec3Like, pitchScale = 1.0): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 15, 1.0, false);
    const f0 = 196 * pitchScale * (0.96 + Math.random() * 0.08);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f0 * 1.06, now);
    osc.frequency.exponentialRampToValueAtTime(f0, now + 0.06);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.94, now + 0.28);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1350, now);
    lp.frequency.exponentialRampToValueAtTime(420, now + 0.26);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.082, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.29);

    osc.connect(lp);
    lp.connect(g);
    g.connect(sp.dest);
    this.disconnectOnEnded(osc, osc, lp, g, ...sp.cleanup);
    osc.start(now);
    osc.stop(now + 0.31);
  }

  public playHumanGasp(worldPos?: Vec3Like, voicePitch = 1.05): void {
    if (!this.ctx || !this.voiceGain) return;
    const sp = this.createLocalizedVoiceOut(worldPos, 19.5, 4.0);
    if (!sp) return;
    const now = this.ctx.currentTime;
    const vp = Math.max(0.78, Math.min(1.42, voicePitch)) * (0.95 + Math.random() * 0.1);
    this.triggerHumanFormantSyllable({
      t0: now + 0.01,
      dur: 0.16,
      f0Start: 230 * vp,
      f0Peak: 345 * vp,
      f0End: 298 * vp,
      f1: 640,
      f1End: 560,
      f2: 1320,
      f2End: 1180,
      f3Gain: 0.06,
      breath: 0.55,
      gain: 0.115,
      dest: sp.dest,
      cleanup: sp.cleanup,
    });
  }

  public playBuskerGrooveFlourish(worldPos?: Vec3Like): void {
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const cell = MODAL_CELLS[this.modalIndex];
    const transpose = Math.max(0.88, Math.min(1.16, (cell.bassRoot < 92 ? cell.bassRoot * 2.0 : cell.bassRoot) / 98.0));
    const chord = [98.0, 146.83, 196.0, 246.94, 329.63, 392.0].map((f) => f * transpose);
    if (this.buskerBodyEq && (!worldPos || Math.hypot(worldPos.x - 33.5, worldPos.z - 39.5) < 10.0)) {
      this.triggerGuitarBodyTap(now, 0.12);
      chord.forEach((freq, idx) => {
        this.triggerBuskerString(
          freq,
          0.22 - idx * 0.016,
          now + 0.018 + idx * 0.022,
          1.24,
          idx < 2 ? 'thumb' : 'strum'
        );
      });
      return;
    }
    chord.forEach((freq, idx) => {
      window.setTimeout(() => {
        this.triggerGuitarPluck(freq, 0.15 - idx * 0.012, worldPos);
      }, idx * 24);
    });
  }

  public playWingFlap(strength = 1.0, startTime?: number): void {
    if (!this.ctx || !this.sfxGain || !this.flapBuf) return;
    const baseTime =
      startTime !== undefined ? Math.max(this.ctx.currentTime, startTime) : this.ctx.currentTime;
    for (let beat = 0; beat < 3; beat++) {
      const t0 = baseTime + beat * 0.048;
      const src = this.ctx.createBufferSource();
      src.buffer = this.flapBuf;
      src.playbackRate.value = 0.94 + Math.random() * 0.12;

      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(490 - beat * 55, t0);
      bp.frequency.exponentialRampToValueAtTime(210, t0 + 0.05);
      bp.Q.value = 1.1;

      const g = this.ctx.createGain();
      g.gain.value = 0.088 * strength * (1.0 - beat * 0.22);

      src.connect(bp);
      bp.connect(g);
      g.connect(this.sfxGain);
      this.disconnectOnEnded(src, src, bp, g);
      src.start(t0);
    }
  }

  /**
   * Subtle, airy single-wingstroke whoosh + feather-quill whisper emitted rhythmically
   * while the sparrow is actively flapping, braking, or flaring in flight.
   */
  public playFlightWingbeat(intensity = 0.5): void {
    if (!this.ctx || !this.sfxGain || !this.flapBuf) return;
    const now = this.ctx.currentTime;
    const amp = Math.max(0.08, Math.min(1.0, intensity));
    const jitter = 0.91 + Math.random() * 0.18;

    const whoosh = this.ctx.createBufferSource();
    whoosh.buffer = this.flapBuf;
    whoosh.playbackRate.value = 0.92 * jitter;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(415 * jitter, now);
    bp.frequency.exponentialRampToValueAtTime(185, now + 0.052);
    bp.Q.value = 0.85;

    const wg = this.ctx.createGain();
    wg.gain.value = 0.028 * amp;

    whoosh.connect(bp);
    bp.connect(wg);
    wg.connect(this.sfxGain);
    this.disconnectOnEnded(whoosh, whoosh, bp, wg);
    whoosh.start(now);

    if (this.chiffBuf) {
      const quill = this.ctx.createBufferSource();
      quill.buffer = this.chiffBuf;
      quill.playbackRate.value = 0.82 * jitter;

      const qbp = this.ctx.createBiquadFilter();
      qbp.type = 'bandpass';
      qbp.frequency.setValueAtTime(2150 * jitter, now + 0.004);
      qbp.frequency.exponentialRampToValueAtTime(1320, now + 0.022);
      qbp.Q.value = 1.2;

      const qg = this.ctx.createGain();
      qg.gain.value = 0.009 * amp;

      quill.connect(qbp);
      qbp.connect(qg);
      qg.connect(this.sfxGain);
      this.disconnectOnEnded(quill, quill, qbp, qg);
      quill.start(now + 0.004);
    }
  }

  public playHop(surface: SurfaceSoundType = 'stone'): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    if (surface === 'water') {
      this.playWaterPlop();
      return;
    }

    const jitter = 0.94 + Math.random() * 0.12;
    for (let tap = 0; tap < 2; tap++) {
      const t0 = now + tap * 0.026;
      const ampScale = tap === 0 ? 0.72 : 1.0;

      const bodyOsc = this.ctx.createOscillator();
      bodyOsc.type = surface === 'metal' ? 'sine' : 'triangle';

      const bodyPitch =
        surface === 'wood'
          ? 245
          : surface === 'metal'
            ? 780
            : surface === 'fabric'
              ? 145
              : surface === 'foliage'
                ? 310
                : 410;

      bodyOsc.frequency.setValueAtTime(bodyPitch * jitter * (tap === 1 ? 1.08 : 1.0), t0);
      bodyOsc.frequency.exponentialRampToValueAtTime(bodyPitch * 0.44, t0 + 0.042);

      const bg = this.ctx.createGain();
      bg.gain.setValueAtTime(0.088 * ampScale, t0);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.048);
      bodyOsc.connect(bg);
      bg.connect(this.sfxGain);
      this.disconnectOnEnded(bodyOsc, bodyOsc, bg);
      bodyOsc.start(t0);
      bodyOsc.stop(t0 + 0.052);

      if (surface !== 'fabric') {
        const clawOsc = this.ctx.createOscillator();
        clawOsc.type = 'sine';
        const clawFreq =
          surface === 'metal'
            ? 2350
            : surface === 'stone'
              ? 1680
              : surface === 'wood'
                ? 1120
                : 1350;
        clawOsc.frequency.setValueAtTime(clawFreq * jitter, t0);
        clawOsc.frequency.exponentialRampToValueAtTime(clawFreq * 0.55, t0 + 0.015);

        const cg = this.ctx.createGain();
        cg.gain.setValueAtTime(0.048 * ampScale, t0);
        cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.018);
        clawOsc.connect(cg);
        cg.connect(this.sfxGain);
        this.disconnectOnEnded(clawOsc, clawOsc, cg);
        clawOsc.start(t0);
        clawOsc.stop(t0 + 0.02);
      }
    }

    if (surface === 'foliage') {
      this.playFeatherRuffle(0.45);
    }
  }

  public playLanding(impactSpeed: number, surface: SurfaceSoundType = 'stone'): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const intensity = Math.min(1.0, Math.max(0.25, impactSpeed / 16.0));

    const thud = this.ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(195 + intensity * 70, now);
    thud.frequency.exponentialRampToValueAtTime(62, now + 0.085 + intensity * 0.04);

    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.16 * intensity, now);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.11 + intensity * 0.04);
    thud.connect(tg);
    tg.connect(this.sfxGain);
    this.disconnectOnEnded(thud, thud, tg);
    thud.start(now);
    thud.stop(now + 0.16);

    this.playHop(surface);
    if (intensity > 0.52) {
      this.playFeatherRuffle(intensity * 0.85);
    }
  }

  public playPerchGrip(surface: SurfaceSoundType = 'wood'): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    [0, 0.028].forEach((delay, idx) => {
      const t0 = now + delay;
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      const base = surface === 'metal' ? 1450 : surface === 'stone' ? 1180 : 940;
      const f = base * (idx === 0 ? 1.0 : 1.26);
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.65, t0 + 0.022);

      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.075, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.026);
      osc.connect(g);
      g.connect(this.sfxGain!);
      this.disconnectOnEnded(osc, osc, g);
      osc.start(t0);
      osc.stop(t0 + 0.03);
    });
  }

  public playCuteBump(surface: SurfaceSoundType | 'ceramic' | 'human' = 'wood'): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const bonk = this.ctx.createOscillator();
    bonk.type = 'sine';
    const startF =
      surface === 'ceramic'
        ? 380
        : surface === 'metal'
          ? 320
          : surface === 'stone'
            ? 250
            : 210;
    bonk.frequency.setValueAtTime(startF, now);
    bonk.frequency.exponentialRampToValueAtTime(95, now + 0.055);
    bonk.frequency.exponentialRampToValueAtTime(145, now + 0.11);

    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(0.2, now);
    bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    bonk.connect(bg);
    bg.connect(this.sfxGain);
    this.disconnectOnEnded(bonk, bonk, bg);
    bonk.start(now);
    bonk.stop(now + 0.14);

    const squeak = this.ctx.createOscillator();
    squeak.type = 'sine';
    squeak.frequency.setValueAtTime(1950, now + 0.035);
    squeak.frequency.exponentialRampToValueAtTime(2680, now + 0.068);
    squeak.frequency.exponentialRampToValueAtTime(1720, now + 0.115);

    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now + 0.035);
    sg.gain.linearRampToValueAtTime(0.095, now + 0.048);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.125);
    squeak.connect(sg);
    sg.connect(this.sfxGain);
    this.disconnectOnEnded(squeak, squeak, sg);
    squeak.start(now + 0.035);
    squeak.stop(now + 0.135);

    this.playFeatherRuffle(0.8);
  }

  private playFeatherRuffle(strength = 0.6): void {
    if (!this.ctx || !this.sfxGain || !this.ruffleBuf) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.ruffleBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1850;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.value = 0.085 * strength;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfxGain);
    this.disconnectOnEnded(src, src, bp, g);
    src.start(now);
  }

  public playCageUnlatch(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    [1320, 1980].forEach((f, i) => {
      const t0 = now + i * 0.045;
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 1.35, t0 + 0.025);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.13, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      osc.connect(g);
      g.connect(this.sfxGain!);
      this.disconnectOnEnded(osc, osc, g);
      osc.start(t0);
      osc.stop(t0 + 0.045);
    });

    const creak = this.ctx.createOscillator();
    creak.type = 'sawtooth';
    creak.frequency.setValueAtTime(310, now + 0.09);
    creak.frequency.exponentialRampToValueAtTime(495, now + 0.36);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 920;
    bp.Q.value = 4.5;
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.0001, now + 0.09);
    cg.gain.linearRampToValueAtTime(0.045, now + 0.16);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    creak.connect(bp);
    bp.connect(cg);
    cg.connect(this.sfxGain);
    this.disconnectOnEnded(creak, creak, bp, cg);
    creak.start(now + 0.09);
    creak.stop(now + 0.44);

    // Warm marimba fifth
    const cell = MODAL_CELLS[this.modalIndex];
    this.triggerMarimbaNote(cell.malletScale[4], 0.095, 0, now + 0.08);
  }

  public playAwningBounce(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(265, now + 0.085);
    osc.frequency.exponentialRampToValueAtTime(155, now + 0.22);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.19, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    osc.connect(g);
    g.connect(this.sfxGain);
    this.disconnectOnEnded(osc, osc, g);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playBeakSnap(pickUp = true): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pickUp ? 560 : 420, now);
    osc.frequency.exponentialRampToValueAtTime(pickUp ? 840 : 260, now + 0.04);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.11, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    osc.connect(g);
    g.connect(this.sfxGain);
    this.disconnectOnEnded(osc, osc, g);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playBreadcrumbCrunch(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    for (let i = 0; i < CRUMB_BITE_SPECS.length; i++) {
      const bite = CRUMB_BITE_SPECS[i];
      const buf = this.crumbBiteBufs[i];
      const t0 = now + bite.delay;

      if (buf) {
        const noiseSrc = this.ctx.createBufferSource();
        noiseSrc.buffer = buf;

        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(bite.bpFreq * (0.94 + Math.random() * 0.12), t0);
        bp.Q.value = 1.75;

        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(bite.amp, t0);
        ng.gain.exponentialRampToValueAtTime(0.001, t0 + bite.dur);

        noiseSrc.connect(bp);
        bp.connect(ng);
        ng.connect(this.sfxGain);
        this.disconnectOnEnded(noiseSrc, noiseSrc, bp, ng);
        noiseSrc.start(t0);
      }

      const snap = this.ctx.createOscillator();
      snap.type = 'triangle';
      snap.frequency.setValueAtTime(bite.popFreq, t0);
      snap.frequency.exponentialRampToValueAtTime(165, t0 + 0.026);

      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(bite.amp * 0.48, t0);
      sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);

      snap.connect(sg);
      sg.connect(this.sfxGain);
      this.disconnectOnEnded(snap, snap, sg);
      snap.start(t0);
      snap.stop(t0 + 0.034);
    }
  }

  public playWaterPlop(worldPos?: Vec3Like): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 15, 1.05, false);
    const jitter = 0.92 + Math.random() * 0.16;

    // 1. Crisp water-surface pat splash
    if (this.ruffleBuf) {
      const slap = this.ctx.createBufferSource();
      slap.buffer = this.ruffleBuf;
      slap.playbackRate.value = 1.15 * jitter;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1950 * jitter, now);
      bp.frequency.exponentialRampToValueAtTime(920, now + 0.065);
      bp.Q.value = 1.4;
      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(0.088, now);
      sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.072);
      slap.connect(bp);
      bp.connect(sg);
      sg.connect(sp.dest);
      this.disconnectOnEnded(slap, slap, bp, sg);
      slap.start(now);
    }

    // 2. Buoyant hollow water plop
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(295 * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(790 * jitter, now + 0.082);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.155, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
    osc.connect(g);
    g.connect(sp.dest);

    // 3. Sparkling secondary droplet bead
    const drop = this.ctx.createOscillator();
    drop.type = 'sine';
    drop.frequency.setValueAtTime(540 * jitter, now + 0.048);
    drop.frequency.exponentialRampToValueAtTime(1020 * jitter, now + 0.095);
    const dg = this.ctx.createGain();
    dg.gain.setValueAtTime(0.065, now + 0.048);
    dg.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    drop.connect(dg);
    dg.connect(sp.dest);

    this.disconnectOnEnded(osc, osc, g);
    this.disconnectOnEnded(drop, drop, dg, ...sp.cleanup);
    osc.start(now);
    osc.stop(now + 0.115);
    drop.start(now + 0.048);
    drop.stop(now + 0.12);
  }

  public playWaterSplosh(worldPos?: Vec3Like, intensity = 1.0): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    this.addChaosImpulse(0.32);
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 17, 1.0, false);
    const amp = Math.max(0.45, Math.min(1.6, intensity));
    const jitter = 0.93 + Math.random() * 0.14;

    // 1. Deep submerged cavity plunge ("KER-SPLOSH")
    const plunge = this.ctx.createOscillator();
    plunge.type = 'sine';
    plunge.frequency.setValueAtTime(185 * jitter, now);
    plunge.frequency.exponentialRampToValueAtTime(58 * jitter, now + 0.21);
    const pg = this.ctx.createGain();
    pg.gain.setValueAtTime(0.21 * amp, now);
    pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    plunge.connect(pg);
    pg.connect(sp.dest);
    this.disconnectOnEnded(plunge, plunge, pg);
    plunge.start(now);
    plunge.stop(now + 0.255);

    // 2. Frothy whitewater spray burst
    const noiseBuf = this.shakeBuf ?? this.ruffleBuf;
    if (noiseBuf) {
      const spray = this.ctx.createBufferSource();
      spray.buffer = noiseBuf;
      spray.playbackRate.value = 0.78 * jitter;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1850, now);
      bp.frequency.exponentialRampToValueAtTime(640, now + 0.24);
      bp.Q.value = 1.1;
      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(0.16 * amp, now);
      sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      spray.connect(bp);
      bp.connect(sg);
      sg.connect(sp.dest);
      this.disconnectOnEnded(spray, spray, bp, sg);
      spray.start(now);
    }

    // 3. Upward hollow air-cavity gulp + cascading water droplets
    const bubbles = [
      { dt: 0.042, f0: 235, f1: 860, dur: 0.095, g: 0.145 * amp },
      { dt: 0.115, f0: 360, f1: 1080, dur: 0.075, g: 0.095 * amp },
      { dt: 0.195, f0: 520, f1: 1240, dur: 0.055, g: 0.062 * amp },
      { dt: 0.275, f0: 610, f1: 1380, dur: 0.048, g: 0.045 * amp },
    ];
    bubbles.forEach((b, idx) => {
      const t0 = now + b.dt;
      const bOsc = this.ctx!.createOscillator();
      bOsc.type = 'sine';
      bOsc.frequency.setValueAtTime(b.f0 * jitter, t0);
      bOsc.frequency.exponentialRampToValueAtTime(b.f1 * jitter, t0 + b.dur);
      const bg = this.ctx!.createGain();
      bg.gain.setValueAtTime(b.g, t0);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + b.dur + 0.012);
      bOsc.connect(bg);
      bg.connect(sp.dest);
      if (idx === bubbles.length - 1) {
        this.disconnectOnEnded(bOsc, bOsc, bg, ...sp.cleanup);
      } else {
        this.disconnectOnEnded(bOsc, bOsc, bg);
      }
      bOsc.start(t0);
      bOsc.stop(t0 + b.dur + 0.02);
    });
  }

  public playPropImpact(kind: string, worldPos?: Vec3Like, impactSpeed = 3.0): void {
    if (!this.ctx || !this.sfxGain) return;
    const norm = Math.min(1.0, Math.max(0.16, (impactSpeed - 0.85) / 9.5));
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 14, 1.08, false);
    const jitter = 0.93 + Math.random() * 0.14;

    if (kind === 'shiny_coin' || kind === 'brass_key' || kind === 'eyeglasses') {
      // Bright metallic ring & clink
      const freqs =
        kind === 'eyeglasses' ? [2680, 4120] : kind === 'brass_key' ? [1840, 2960, 4380] : [2320, 3580, 5120];
      freqs.forEach((f, idx) => {
        const osc = this.ctx!.createOscillator();
        osc.type = idx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(f * jitter, now);
        const dur = (0.16 - idx * 0.03) * (0.75 + norm * 0.45);
        const g = this.ctx!.createGain();
        g.gain.setValueAtTime((0.085 - idx * 0.022) * norm, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(g);
        g.connect(sp.dest);
        if (idx === freqs.length - 1) {
          this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
        } else {
          this.disconnectOnEnded(osc, osc, g);
        }
        osc.start(now);
        osc.stop(now + dur + 0.015);
      });
      return;
    }

    if (
      kind === 'ceramic_mug' ||
      kind === 'teacup' ||
      kind === 'porcelain_plate' ||
      kind === 'pigment_jar' ||
      kind === 'terracotta_pot' ||
      kind === 'glass_carafe' ||
      kind === 'ceramic_vase'
    ) {
      // Glazed porcelain / terracotta / glass clack
      const base = kind === 'terracotta_pot' ? 680 : kind === 'glass_carafe' ? 1640 : 1220;
      const o1 = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      o1.type = 'triangle';
      o2.type = 'sine';
      o1.frequency.setValueAtTime(base * jitter, now);
      o1.frequency.exponentialRampToValueAtTime(base * 0.86 * jitter, now + 0.09);
      o2.frequency.setValueAtTime(base * 1.62 * jitter, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.11 * norm, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      o1.connect(g);
      o2.connect(g);
      g.connect(sp.dest);
      this.disconnectOnEnded(o2, o2);
      this.disconnectOnEnded(o1, o1, g, ...sp.cleanup);
      o1.start(now);
      o2.start(now);
      o2.stop(now + 0.115);
      o1.stop(now + 0.12);
      return;
    }

    if (kind === 'coffee_cup') {
      // Hollow paper-cup tok
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(470 * jitter, now);
      osc.frequency.exponentialRampToValueAtTime(205 * jitter, now + 0.058);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.095 * norm, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.068);
      osc.connect(g);
      g.connect(sp.dest);
      this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
      osc.start(now);
      osc.stop(now + 0.075);
      return;
    }

    if (kind === 'studio_book' || kind === 'pinecone' || kind === 'twig') {
      // Warm woody / hardcover clack-thump
      const base = kind === 'studio_book' ? 245 : kind === 'pinecone' ? 360 : 520;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base * jitter, now);
      osc.frequency.exponentialRampToValueAtTime(base * 0.42, now + 0.065);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.11 * norm, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
      osc.connect(g);
      g.connect(sp.dest);
      this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
      osc.start(now);
      osc.stop(now + 0.082);
      return;
    }

    if (kind === 'paper_airplane' || kind === 'ribbon' || kind === 'flower_sprig' || kind === 'velvet_down') {
      // Soft paper / petal flutter brush
      if (this.ruffleBuf) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.ruffleBuf;
        src.playbackRate.value = 1.2 * jitter;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2150 * jitter;
        bp.Q.value = 1.5;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.068 * norm, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
        src.connect(bp);
        bp.connect(g);
        g.connect(sp.dest);
        this.disconnectOnEnded(src, src, bp, g, ...sp.cleanup);
        src.start(now);
        return;
      }
    }

    // Pastries, produce, sugar cubes & seeds: cushioned pat + crisp crust/seed tick
    const isTiny = kind === 'sugar_cube' || kind === 'seed';
    const osc = this.ctx.createOscillator();
    osc.type = isTiny ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime((isTiny ? 760 : 215) * jitter, now);
    osc.frequency.exponentialRampToValueAtTime((isTiny ? 320 : 82) * jitter, now + (isTiny ? 0.032 : 0.065));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime((isTiny ? 0.065 : 0.095) * norm, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (isTiny ? 0.038 : 0.075));
    osc.connect(g);
    g.connect(sp.dest);
    this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
    osc.start(now);
    osc.stop(now + (isTiny ? 0.044 : 0.082));
  }

  public playIronCreak(worldPos?: Vec3Like, intensity = 0.7): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 14, 1.1, true);
    const pitch = 0.9 + Math.random() * 0.2;
    const amp = Math.max(0.2, Math.min(1.0, intensity));

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(385 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(515 * pitch, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(430 * pitch, now + 0.24);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1360 * pitch;
    bp.Q.value = 6.2;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.052 * amp, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

    osc.connect(bp);
    bp.connect(g);
    g.connect(sp.dest);
    this.disconnectOnEnded(osc, osc, bp, g, ...sp.cleanup);
    osc.start(now);
    osc.stop(now + 0.275);
  }

  public playPinwheelWhir(worldPos?: Vec3Like, spinSpeed = 8.0): void {
    if (!this.ctx || !this.sfxGain || !this.chiffBuf) return;
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 13, 1.1, true);
    const norm = Math.min(1.0, Math.max(0.3, spinSpeed / 14.0));
    const blades = 4;
    for (let i = 0; i < blades; i++) {
      const t0 = now + i * (0.048 - norm * 0.016);
      const src = this.ctx.createBufferSource();
      src.buffer = this.chiffBuf;
      src.playbackRate.value = 1.05 + norm * 0.35 + i * 0.05;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1750 + i * 190;
      bp.Q.value = 1.7;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.045 * norm, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.042);
      src.connect(bp);
      bp.connect(g);
      g.connect(sp.dest);
      if (i === blades - 1) {
        this.disconnectOnEnded(src, src, bp, g, ...sp.cleanup);
      } else {
        this.disconnectOnEnded(src, src, bp, g);
      }
      src.start(t0);
    }
  }

  public playCoinClink(worldPos?: Vec3Like): void {
    if (!this.ctx || !this.sfxGain) return;
    const cell = MODAL_CELLS[this.modalIndex];
    const f = cell.malletScale[6];
    if (worldPos) {
      this.triggerGuitarPluck(f * 2, 0.095, worldPos);
    } else {
      this.triggerMarimbaNote(f * 2, 0.095, 0);
      this.triggerPluckedHarpNote(f * 3, 0.05, 0.15);
    }
  }

  public playTowerBell(noteIndex = 0): void {
    if (!this.ctx || !this.musicGain) return;
    const cell = MODAL_CELLS[this.modalIndex];
    const freq = cell.malletScale[(noteIndex * 2) % 6];
    this.triggerVibraphoneNote(freq, 0.12, 2.8);
    this.triggerBassMarimbaNote(freq * 0.5, 0.13);
  }

  public playVignetteBloom(): void {
    if (!this.ctx || !this.musicGain) return;
    const baseTime = this.ctx.currentTime;
    const cell = MODAL_CELLS[this.modalIndex];
    const chord = [
      cell.malletScale[0],
      cell.malletScale[3],
      cell.malletScale[4],
      cell.malletScale[7],
      cell.malletScale[9],
    ];
    this.triggerBassMarimbaNote(cell.bassRoot, 0.16, baseTime);
    chord.forEach((f, idx) => {
      const noteTime = baseTime + idx * 0.105;
      this.triggerMarimbaNote(f, 0.115, (idx - 2) * 0.22, noteTime);
      this.triggerPluckedHarpNote(f * 1.5, 0.06, (2 - idx) * 0.2, noteTime + 0.045);
      if (idx >= 3) {
        this.triggerVibraphoneNote(f * 2, 0.045, 2.2, noteTime);
      }
    });
    this.phraseCooldown = Math.max(this.phraseCooldown, 3.2);
  }

  public playDizzyWallSmack(): void {
    this.playCuteBump('wood');
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now + 0.05);
    osc.frequency.exponentialRampToValueAtTime(390, now + 0.62);

    lfo.type = 'sine';
    lfo.frequency.value = 13.5;
    lfoGain.gain.value = 42;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.085, now + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

    osc.connect(g);
    g.connect(this.sfxGain);
    this.disconnectOnEnded(lfo, lfo, lfoGain);
    this.disconnectOnEnded(osc, osc, g);
    osc.start(now);
    lfo.start(now);
    lfo.stop(now + 0.675);
    osc.stop(now + 0.68);
  }

  public playFeatherRuffleShake(): void {
    if (!this.ctx || !this.sfxGain || !this.shakeBuf) return;
    const now = this.ctx.currentTime;

    for (let i = 0; i < 5; i++) {
      const t0 = now + i * 0.068;
      const src = this.ctx.createBufferSource();
      src.buffer = this.shakeBuf;

      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 950 + i * 180;
      bp.Q.value = 1.6;

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.16, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.058);

      src.connect(bp);
      bp.connect(g);
      g.connect(this.sfxGain);
      this.disconnectOnEnded(src, src, bp, g);
      src.start(t0);
    }

    this.playSparrowChirp(false, now + 0.34);
  }

  public playPigeonFlutter(worldPos?: Vec3Like): void {
    if (!this.ctx || !this.sfxGain) return;
    this.addChaosImpulse(0.55);
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 18, 1.0, false);

    for (let i = 0; i < 6; i++) {
      const t0 = now + i * 0.055;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420 + (i % 2) * 95, t0);
      osc.frequency.exponentialRampToValueAtTime(290, t0 + 0.09);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.095, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);

      osc.connect(g);
      g.connect(sp.dest);
      if (i === 5) {
        this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
      } else {
        this.disconnectOnEnded(osc, osc, g);
      }
      osc.start(t0);
      osc.stop(t0 + 0.11);
      this.playWingFlap(0.75, now + i * 0.05);
    }
  }

  public playBicycleBell(worldPos?: Vec3Like): void {
    if (!this.ctx || !this.sfxGain) return;
    this.addChaosImpulse(0.42);
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 14, 1.15, true);
    const ringOffsets = [0, 0.055, 0.18, 0.235];
    ringOffsets.forEach((off, idx) => {
      const t0 = now + off;
      const o1 = this.ctx!.createOscillator();
      const o2 = this.ctx!.createOscillator();
      o1.type = 'sine';
      o2.type = 'triangle';
      o1.frequency.value = 1975.5;
      o2.frequency.value = 2960.0;

      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.075, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);

      o1.connect(g);
      o2.connect(g);
      g.connect(sp.dest);
      this.disconnectOnEnded(o2, o2);
      if (idx === ringOffsets.length - 1) {
        this.disconnectOnEnded(o1, o1, g, ...sp.cleanup);
      } else {
        this.disconnectOnEnded(o1, o1, g);
      }
      o1.start(t0);
      o2.start(t0);
      o2.stop(t0 + 0.295);
      o1.stop(t0 + 0.3);
    });
  }

  public playChefShout(worldPos?: Vec3Like, voicePitch = 0.84): void {
    this.playHumanYell(worldPos, voicePitch, 'chef');
  }

  public playBellTowerBong(worldPos?: Vec3Like): void {
    if (!this.ctx || !this.sfxGain) return;
    this.addChaosImpulse(0.5);
    const now = this.ctx.currentTime;
    const sp = this.createSpatialOneShotOut(worldPos, 28, 0.85, false);
    const partials = [
      { f: 196.0, amp: 0.19, dur: 3.2 },
      { f: 392.0, amp: 0.14, dur: 2.6 },
      { f: 466.16, amp: 0.09, dur: 2.0 },
      { f: 587.33, amp: 0.07, dur: 1.7 },
    ];
    partials.forEach((p, idx) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = p.f;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(p.amp, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + p.dur);
      osc.connect(g);
      g.connect(sp.dest);
      if (idx === partials.length - 1) {
        this.disconnectOnEnded(osc, osc, g, ...sp.cleanup);
      } else {
        this.disconnectOnEnded(osc, osc, g);
      }
      osc.start(now);
      osc.stop(now + p.dur + 0.05);
    });
  }
}
