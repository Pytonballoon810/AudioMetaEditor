# TODO

## Features

- [ ] Add file change listener to automatically update the app when files are added/removed/changed in the directory. Currently, the app only updates when the directory is reloaded.
- [ ] Add app as option in the "Open with" context menu for audio files and directories in the file manager.
- [ ] Add filling outline as border for track items in the track list when they are loaded. This indicates which tracks have been loaded/cached and which are still loading. This is especially useful when loading large directories, as it can take some time for all tracks to be loaded and cached.
- [ ] Also add that unloaded tracks are displayed greyed out but are still index instantly but make them only clickable when they are loaded.
- [ ] When updating metadata of a track, update the track item in the track list immediately to reflect the changes. Move the process to another thread to avoid blocking the UI and make it more responsive.
- [ ] Split selected Segment from wav into a new track and save it as a new file in the same Album directory. This is useful for splitting long recordings into multiple tracks. This should prompt teh user to enter the title manually but copy the other metadata from the original track. This should also update the track list and the album metadata accordingly.
- [ ] Add option to add up to 10 VST plugins to apply to the track. Should be implemented as the todo below would be implemented, but instead of applying the EQ settings, it would apply the VST plugin settings. This would allow users to apply effects to their tracks without having to use a separate DAW. The VST plugins should be applied temporarily until they are applied like the other edits.
(- [ ] Add simple EQ tool for waveform editor. This will apply the EQ settings to the track when it is played. This EQ should be temporarily applied until it is applied like the other edits.)

## Style

- [x] the styling of the album metadata should be more concise. the bar currently extends too far beyond the actual buttons and i want the toolbar and the cover to be combined in one section like it is done in the track metadata panel

## Bugs

- [x] Setting the track cover sometimes is only displayed in app and not after reloading the directory.
- [x] Some cover images are displayed correctly in the app but not in Navidrome web ui.

## CD/CI

- [ ] Add a workflow to automatically build and publish the app to GitHub releases when a tag is set.
