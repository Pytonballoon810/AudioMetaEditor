# TODO

## Features

- [x] Add file change listener to automatically update the app when files are added/removed/changed in the directory. Currently, the app only updates when the directory is reloaded.
- [x] Add app as option in the "Open with" context menu for audio files and directories in the file manager.
- [x] Add filling outline as border for track items in the track list when they are loaded. This indicates which tracks have been loaded/cached and which are still loading. This is especially useful when loading large directories, as it can take some time for all tracks to be loaded and cached.
- [x] Also add that unloaded tracks are displayed greyed out but are still index instantly but make them only clickable when they are loaded.
- [x] When updating metadata of a track, update the track item in the track list immediately to reflect the changes. Move the process to another thread to avoid blocking the UI and make it more responsive.
- [x] Split selected Segment from wav into a new track and save it as a new file in the same Album directory. This is useful for splitting long recordings into multiple tracks. This should prompt teh user to enter the title manually but copy the other metadata from the original track. This should also update the track list and the album metadata accordingly.
- [ ] Add option to add up to 10 VST plugins to apply to the track. Should be implemented as the todo below would be implemented, but instead of applying the EQ settings, it would apply the VST plugin settings. This would allow users to apply effects to their tracks without having to use a separate DAW. The VST plugins should be applied temporarily until they are applied like the other edits.
(- [ ] Add simple EQ tool for waveform editor. This will apply the EQ settings to the track when it is played. This EQ should be temporarily applied until it is applied like the other edits.)

## Style

- [x] The apply toggles in the album metadata panel should be replaced with sliding switches that match the overall design of the app. This will make it more visually appealing and easier to use.

## Bugs

- [x] Spacebar isnt handled as input when editing track metadata, like entering the track title. This is because spacebar is used to play/pause the track, but it should be possible to use spacebar as input when text fields are focused.
- [x] Loading progress is not updated when indexing a directory.

## CD/CI

- [ ] Add a workflow to automatically build and publish the app to GitHub releases when a tag is set.
