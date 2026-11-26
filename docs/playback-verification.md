# Playback verification

Run the dawt scenario suite and build the booth before starting a live test.

```sh
npm --prefix web/src ci
npm --prefix web/src test
npm --prefix web/src run build
```

Run `./setup`, `.venv/bin/python scripts/test-python.py`, and `npm test` from an [Afterhours checkout](https://github.com/robertschultz/afterhours). Its simulated tests use disposable catalogs, simulated native decks, and local test peers. They do not purchase or stream music.

## Automated scenarios

| What the user does | What the test verifies |
| --- | --- |
| Starts a measured set, a quick set, or a quick set with a fixed blend | dawt sends the selected pacing and one rolling start to Afterhours. A declined plan sends no Play. |
| Searches, queues, or reorders records before or during playback | dawt sends exact recording IDs and routes live insertions through Afterhours. |
| Uses Mix Now, Take Over, or Stop | The booth binds Mix Now to the current session and sends the requested native transport action. |
| Starts a set through Talk, checks progress, asks Dot to stop, or closes Talk | dawt forwards the operation over the Afterhours Talk and agent routes. Closing releases the peer. |
| Plays through a late handoff, a changed deck, or a stalled audio clock | Afterhours uses verified cues when they are ready and declines unverified transport. Recovery and finite-set cases run in the engine suite. |
| Moves from an outgoing record to an incoming one while the next queue revision is pending | Up Next keeps its space, uses staged record metadata, and updates when Afterhours commits a track. |
| Listens to the VirtualDJ stream and hears a reply from Dot | dawt’s audio worklet renders stereo samples, drops stale buffers when the stream changes, and restores music volume when the reply ends. |

## Live scenarios

Start the booth with `python3 scripts/launch.py --dj` and enable **Hear stream**. Verify that VirtualDJ is routed to an available output and that both decks are paused before starting a new test. Confirm actual playback by checking for an advancing native playhead and a nonzero music level in the browser through at least one section with no speech.

| Scenario | Pass criteria |
| --- | --- |
| Talk starter | Ask Dot to play an artist or genre. The crate search and opening record match the request. The opening is audible while the next record is prepared. |
| Measured booth set | Start with two available records. Afterhours chooses and prepares subsequent records. Observe four distinct audible tracks, three real crossfades, and a fifth track in Up Next. |
| Quick booth set | Repeat with a quick set and a fixed-blend preset. Confirm that the upcoming queue is adopted and the playhead remains continuous at each mix. |
| Queue edits and native controls | Add a future record, use Mix Now, and verify the incoming track and crossfader. Take over and confirm Afterhours stops scheduling while the current record continues. |
| Talk Stop and reconnect | Ask Dot to stop during playback, then confirm both decks pause. Close and reopen Talk and verify a subsequent request reaches Afterhours. |
| Audio interruption and recovery | With a disposable set, observe the booth when the output is unavailable. Verify it reports the failure and does not retry Play on its own. Restore the configured output and confirm a new explicit start plays audible music. |

Record the dawt and Afterhours commit IDs, tested output device, played track titles, crossfade evidence, and any missing Up Next states. Keep private provider data and audio captures out of the repositories.
