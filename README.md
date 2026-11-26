# Dawt

Dawt is a real-time Unreal Engine DJ character with a browser booth. The
standalone stage previews the character without music. The DJ booth connects
to a separately installed Afterhours engine and relies on VirtualDJ for playback.

## Build and run

Install Unreal Engine 5.8 on macOS and build the browser client with Node.js.

```sh
npm --prefix Web/Source ci
npm --prefix Web/Source run build
python3 Tools/launch.py
```

The standalone stage is at `http://127.0.0.1:8170/`. The first launch can
take a few minutes to prepare shaders. Run `python3 Tools/launch.py --stop`
to close the renderer and signaling service.

The set loops automatically. Cue Bounce, Glide, Spin, or Dance, pause the show, toggle the headphones, rotate the camera, or choose another background. The browser receives rendered video. Use the native assets for 3D scene reuse and the companion transparent PNGs for alpha compositing.

## Dot Afterhours booth

Run `python3 Tools/launch.py --dj` and visit `http://127.0.0.1:8170/dj`.
The launcher reuses a healthy local Afterhours engine or starts the checkout
specified by `DOT_AFTERHOURS_ENGINE`. VirtualDJ and Afterhours account and
provider configuration are local to the operator.
Dot talks directly to the engine. Cue is optional.

The live stage fills the browser. The upper-right icons open the booth controls,
switch the Unreal camera, and enter or exit browser full screen. Open the booth
controls for the scene selector, queue and record crate. Twenty-one scenes use the
same live set and booth controls. The panel works in full screen.

**Cinematic camera** moves between wide, portrait, and side-angle views.
It changes framing for record pulls, handoffs, conversation, and dance accents.
The **DJ activity** button shows the current action and its latest detail,
such as the tracks in a mix or live search counts. The two fields update while
the panel is open.
Now Playing displays provider artwork on a spinning record sized to the track details.

**Boiler Room** follows the supplied event references, with scaffolding,
a lit circular sign and an empty performance space. The editable scene is
in `AssetSource/Warehouse/DotBoilerRoom.blend`.

The EndUp, Tunnel and Public Works scenes are interpretations of the clubs'
patio, freight tunnel and main room, respectively. Open their editable scenes
in `AssetSource/Warehouse/DotClubVenues.blend`.

The California scenes place Dot at the Golden Gate waterfront, on a downtown
Los Angeles rooftop, and inside the Rose Bowl. Their editable Blender scenes
are in `AssetSource/Warehouse/DotCaliforniaVenues.blend`.
Choose a studio color for a plain charcoal, ivory, lilac, or mint background.

**Daft Punk Pyramid · Coachella / Alive** puts Dot on a night stage inspired by
the supplied Alive performance photos. Its illuminated podium replaces the normal table,
and the table and crates retain separate visibility toggles. The editable Blender set is
in `AssetSource/Warehouse/DotAlivePyramid.blend`. Use
`Tools/build_alive_pyramid.py` in Blender to regenerate its FBX and palette, then
import `VenueAlivePyramid` and `AlivePyramidPodium` with `Tools/import_warehouse.py`.
[Coachella festival archive](https://doc.coachella.com/) ·
[Alive 2007 lighting reference](https://support.enlighted.com/p/daft-punk-alive-2007).

Use Afterhours to manage search, queue order, playback, cueing, and mixing. From
Dot's controls, search the selected VirtualDJ Beatport crate, choose two or more
records, and start the set. Talk uses the native Afterhours GPT-Live-1.1 service
and delegates music requests to its DJ agent. Dot's live browser renders the
Afterhours program state and drives the character's listening, speaking, and
working poses. Voice audio levels and tone cues are sampled in the browser.
Talk uses Gleam. Feedback such as “more two-step” or “less spinning” updates
Dot's movement preferences on this Mac. Dot picks four- and eight-beat dance
phrases by tempo, energy, recent moves, and those preferences. The playing
deck's beat grid drives its groove and sets the takeoff and landing beats for
jumps, spins, and flips. Dot keeps smaller movements during record handling
and active talkback.

The warehouse scene uses four crates from **Dot - Four Crate Warehouse.blend**,
with blank audience-facing plates.
The Cinematic camera follows the working crate and local record return.
Now Playing shows the record as spinning vinyl, with original Beatport art
clipped to the circular label. The progress rail and track clock share a row
beside the record that reaches the right stage inset. Up Next appears below
that row with the next recording and mix countdown.

Set pacing offers measured mixes, quick sets with 15, 20, or 30 seconds between
track entries, and 15, 20, or 30 second crossfades aligned to full bars.
Mix now advances to the next available cue. In Talk, “next track” uses the same
Afterhours control.

The speaker icon or **Hear stream** enables the VirtualDJ master in the browser.
Dot's macOS helper sends the master directly over loopback, alongside the
separate Unreal video feed. Talk ducks the music while Dot speaks.
macOS may ask for system audio recording permission for the helper.

If the Afterhours engine uses a custom installation, set `DOT_AFTERHOURS_ENGINE`
to the engine directory containing its local Python environment.
`DOT_AFTERHOURS_PORT` selects the music endpoint. A Dot-launched engine uses
the project's `Saved/Afterhours` data root unless `DOT_AFTERHOURS_DATA_ROOT`
is supplied. A healthy engine already on the port is reused with its own data.

The browser voice client is adapted from Afterhours under its MIT license,
listed in `Web/Source/afterhours-LICENSE.md`. The Blender deck and record exports are under
`AssetSource`. The Native Unreal implementation includes the centered
camera, optional broadcast HUD, stage, performer, and audio receiver.

## Edit the project

Open `DotPerformance.uproject` in Unreal Engine 5.8. Open the DotStage map and press Play to run the performance. `Content/Dot/Meshes` contains independently reusable static meshes for Dot's body and headphones, and `Content/Dot/Materials` contains the material assets. Place the **DotPerformer** actor in any level to run the performance under that level's lighting. Its Details panel sets the initial move and headphone visibility. Cue, Set Paused, and Set Headphones Visible are callable from Blueprint. For another Unreal project, migrate the mesh and material packages together and bring over the performer class if you need its motion controls.

`DotShowMode.cpp` assembles the showcase stage. `DotPerformer.cpp` handles motion and headphones independently of the showcase. `AssetSource` stores the neutral FBX source meshes. `Tools/import_dot.py` is the Unreal Python import script. `Web/Source` holds the browser controller and local signaling source, and its build emits the runnable browser pages and signaling bundle into `Web`.

The live preview uses local ports 8170 and 8172. It needs Node.js and the Unreal 5.8 Mac editor. If Unreal is installed elsewhere, set `DOT_UNREAL_EDITOR` to its executable.
