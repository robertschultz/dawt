const DUCKED_MUSIC = 0.23;
const IDLE_VOICE = 0.50;

export function createTalkMix(musicElements, voiceElement) {
  const normalVolume = new WeakMap();
  let music = 1;
  let voice = IDLE_VOICE;
  let targetMusic = 1;
  let targetVoice = IDLE_VOICE;
  let previous = 0;
  let frame = 0;
  function write() {
    for (const element of musicElements()) {
      if (!normalVolume.has(element)) normalVolume.set(element, element.volume);
      element.volume = normalVolume.get(element) * music;
    }
    const element = voiceElement();
    if (element) element.volume = voice;
  }
  function animate(now) {
    frame = 0;
    const seconds = Math.max(0, Math.min(0.1, (now - previous) / 1000));
    previous = now;
    const ease = (value, target, duration) => {
      const next = target + (value - target) * Math.exp(-seconds / duration);
      return Math.abs(next - target) < 0.008 ? target : next;
    };
    music = ease(music, targetMusic, targetMusic < music ? 0.037 : 0.15);
    voice = ease(voice, targetVoice, targetVoice > voice ? 0.016 : 0.075);
    write();
    if (music !== targetMusic || voice !== targetVoice) frame = requestAnimationFrame(animate);
  }
  return (speaking, active = true) => {
    targetMusic = speaking ? DUCKED_MUSIC : 1;
    targetVoice = speaking || !active ? 1 : IDLE_VOICE;
    if (music === targetMusic && voice === targetVoice) {
      write();
    } else if (!frame) {
      previous = performance.now();
      frame = requestAnimationFrame(animate);
    }
  };
}
