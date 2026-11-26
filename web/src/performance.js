export const duration = 16;
export const movements = ['bounce', 'glide', 'spin', 'dance'];
export const labels = {show:'Full performance', bounce:'Bounce', glide:'Glide', spin:'Spin', dance:'Dance'};
const tau = Math.PI * 2;
const wave = (seconds, period) => Math.sin(tau * seconds / period);
const hop = (seconds, period) => Math.max(0, wave(seconds, period));
function smooth(a, b, fraction) {
  const value = Math.max(0, Math.min(1, (fraction-a)/(b-a)));
  return value*value*(3-2*value);
}
export function cue(mode, second) {
  const phase = second % duration;
  const move = mode === 'show' ? movements[Math.floor(phase / 4)] : mode;
  const t = mode === 'show' ? phase % 4 : second;
  let pose;
  switch(move) {
    case 'bounce':
      pose = [0, .44*hop(t,.5), 6*wave(t,1), 7*wave(t,2), 9*wave(t+.10,.5), .12*wave(t,.5)];
      break;
    case 'glide':
      pose = [1.18*wave(t,4), .20*hop(t,.5), -15*wave(t+1,4), -16*wave(t+1,4), 5*wave(t,.5), .045*wave(t,.5)];
      break;
    case 'spin': {
      const segment = t % 2 / 2;
      pose = [.32*wave(t,2), .49*Math.sin(Math.PI*segment), 12*wave(t,2), 360*smooth(0,1,segment), 9*wave(t,1), .08*wave(t,1)];
      break;
    }
    default:
      pose = [.58*wave(t,2), .32*hop(t,.5), -17*wave(t,2), 24*wave(t+.13,1), 14*wave(t+.07,.5), .09*wave(t,.5)];
  }
  if (mode === 'show') {
    const envelope = smooth(0,.23,t)*(1-smooth(3.77,4,t));
    pose[3] = ((pose[3] + 180) % 360) - 180;
    pose = pose.map(value => value*envelope);
  }
  const [travel, lift, tilt, yaw, nod, squash] = pose;
  return {move, travel, lift, tilt, yaw, nod, squash};
}
