export function upNext({ currentId, committed, staged = [], rolling, active, playing, mixing }) {
  const index = staged.findIndex(track => track.id === currentId);
  const preparing = index >= 0 ? staged[index + 1] : null;
  const upcoming = committed?.id && committed.id !== currentId ? committed : null;
  const track = upcoming || preparing;
  const visible = Boolean(track?.title || mixing || rolling || (active && playing));
  const label = [track?.title, track?.artist].filter(Boolean).join(' · ') || (
    rolling === 'held' ? 'No compatible track found' : rolling ? 'Finding a track' : 'End of queue'
  );

  return { upcoming, preparing, visible, label };
}
