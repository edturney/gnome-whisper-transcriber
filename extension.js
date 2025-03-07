// GNOME Extension: Whisper Transcriber
// Description: Records audio, transcribes it using OpenAI Whisper API, and copies to clipboard

const { St, GObject, GLib, Gio, Clutter } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ByteArray = imports.byteArray;
const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;

// Extension state
let indicator = null;
let isRecording = false;
let recordingPath = '';
let recordingProcess = null;
let settings = null;

// API key settings key
const API_KEY_SETTING = 'whisper-api-key';

/**
 * Check if required dependencies are installed
 * @returns {boolean} True if all dependencies are available
 */
function _checkDependencies() {
    let [, , , ffmpegStatus] = GLib.spawn_command_line_sync('which ffmpeg');
    let [, , , curlStatus] = GLib.spawn_command_line_sync('which curl');
    
    let missingDeps = [];
    
    if (ffmpegStatus !== 0) {
        missingDeps.push('ffmpeg');
    }
    
    if (curlStatus !== 0) {
        missingDeps.push('curl');
    }
    
    if (missingDeps.length > 0) {
        Main.notifyError(
            _('Whisper Transcriber Error'), 
            _('Missing required dependencies: %s').format(missingDeps.join(', '))
        );
        return false;
    }
    
    // Check /tmp directory write permissions
    try {
        let tempFile = '/tmp/whisper_transcriber_test_' + Math.floor(Date.now() / 1000);
        GLib.file_set_contents(tempFile, 'test');
        GLib.unlink(tempFile);
    } catch (e) {
        Main.notifyError(
            _('Whisper Transcriber Error'), 
            _('Cannot write to /tmp directory. Check permissions.')
        );
        return false;
    }
    
    return true;
}

const WhisperTranscriberIndicator = GObject.registerClass(
    class WhisperTranscriberIndicator extends PanelMenu.Button {
        _init(depsAvailable = true) {
            super._init(0.0, _('Whisper Transcriber'));
            
            this._depsAvailable = depsAvailable;
            
            // Create the panel icon
            this.icon = new St.Icon({
                icon_name: 'audio-input-microphone-symbolic',
                style_class: 'system-status-icon'
            });
            this.add_child(this.icon);
            
            // Create the menu
            this._buildMenu();
        }
        
        _buildMenu() {
            // Record button
            this.recordItem = new PopupMenu.PopupMenuItem(_('Record Audio'));
            this.recordItem.connect('activate', () => {
                if (this._depsAvailable) {
                    if (isRecording) {
                        this._stopRecording();
                    } else {
                        this._startRecording();
                    }
                } else {
                    this._notify(_('Missing dependencies. Check system logs for details.'));
                }
            });
            this.menu.addMenuItem(this.recordItem);
            
            // If deps are missing, disable the Record Audio item
            if (!this._depsAvailable) {
                this.recordItem.reactive = false;
                this.recordItem.add_style_class_name('error-text');
            }
            
            // Separator
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            
            // Settings
            const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
            settingsItem.connect('activate', () => {
                this._openSettings();
            });
            this.menu.addMenuItem(settingsItem);
        }

        _notify(message) {
            Main.notify(_('Whisper Transcriber'), message);
        }
        
        _openSettings() {
            ExtensionUtils.openPrefs();
        }
        
        _startRecording() {
            if (isRecording) return;
            
            // Check API key
            const apiKey = settings.get_string(API_KEY_SETTING);
            if (!apiKey) {
                this._notify(_('Please set your OpenAI API key in the extension settings'));
                this._openSettings();
                return;
            }
            
            // Simple path in /tmp
            recordingPath = '/tmp/whisper_recording_' + Math.floor(Date.now() / 1000) + '.ogg';
            
            // Update UI
            this.icon.icon_name = 'media-record-symbolic';
            this.icon.style_class = 'system-status-icon recording-active';
            this.recordItem.label.text = _('Stop Recording');
            isRecording = true;
            
            // Start ffmpeg process directly
            try {
                const ffmpegArgs = [
                    'ffmpeg',
                    '-f', 'alsa',
                    '-i', 'default',
                    '-c:a', 'libvorbis',
                    '-y',  // Overwrite output file if it exists
                    recordingPath     // Output file
                ];
                
                // Spawn the process with a unique identifier for easier killing
                this._logDebug(_('Recording...'));
                const [success, pid] = GLib.spawn_async(
                    null,           // Working directory (null = default)
                    ffmpegArgs,     // Arguments
                    null,           // Environment variables (null = inherit)
                    GLib.SpawnFlags.SEARCH_PATH,  // Use PATH to find executable
                    null            // Child setup function
                );
                
                recordingProcess = pid;
            } catch (e) {
                this._notify(_('Error starting recording: %s').format(e.message));
                this._resetUI();
            }
        }
        
        _stopRecording() {
            if (!isRecording) return;
            
            // Kill the recording process more precisely
            try {
                // Use a more specific pkill command to target our ffmpeg instance
                // This pattern matches ffmpeg processes writing to our specific output file
                const killPattern = 'ffmpeg.*' + recordingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const killArgs = ['pkill', '-f', killPattern];
                
                // Fallback to more general ffmpeg kill if the specific kill fails
                try {
                    GLib.spawn_sync(null, killArgs, null, GLib.SpawnFlags.SEARCH_PATH, null);
                } catch (e) {
                    // If the specific kill fails, try a more general approach
                    GLib.spawn_sync(null, ['pkill', 'ffmpeg'], null, GLib.SpawnFlags.SEARCH_PATH, null);
                }
                
                this._logDebug(_('Processing recording...'));
            } catch (e) {
                this._notify(_('Error stopping recording: %s').format(e.message));
            }
            
            // Reset UI
            this._resetUI();
            
            // Process the audio
            this._processAudio(recordingPath);
        }
        
        _resetUI() {
            this.icon.icon_name = 'audio-input-microphone-symbolic';
            this.icon.style_class = 'system-status-icon';
            this.recordItem.label.text = _('Record Audio');
            isRecording = false;
        }
        
        _processAudio(filePath) {
            // Show processing indicator
            this.icon.icon_name = 'emblem-synchronizing-symbolic';
            this.icon.style_class = 'system-status-icon processing-active';
            this.recordItem.reactive = false;
            
            this._logDebug(_('Transcribing...'));
            
            // Get API key from settings
            const apiKey = settings.get_string(API_KEY_SETTING);
            if (!apiKey) {
                this._notify(_('API key not set. Please configure in settings.'));
                this._openSettings();
                this._resetProcessingUI();
                return;
            }
            
            // Run curl asynchronously to avoid UI freezing
            try {
                // Create a temp file for the output
                const outputPath = '/tmp/whisper_output_' + Math.floor(Date.now() / 1000) + '.txt';
                
                // Build a command that writes to the output file
                const command = 'curl -s "https://api.openai.com/v1/audio/transcriptions" ' +
                               '-H "Authorization: Bearer ' + apiKey + '" ' +
                               '-H "Content-Type: multipart/form-data" ' +
                               '-F "file=@' + filePath + '" ' +
                               '-F "model=whisper-1" ' +
                               '-F "response_format=text" > ' + outputPath + ' 2>/tmp/whisper_error.txt';
                
                // Log command for debugging (without API key)
                this._logDebug(_('Running command: %s').format(command.replace(apiKey, 'API_KEY_HIDDEN')));
                
                // Run the command asynchronously
                const [success, pid] = GLib.spawn_async(
                    null,                         // Working directory
                    ['bash', '-c', command],      // Command
                    null,                         // Environment
                    GLib.SpawnFlags.SEARCH_PATH,  // Flags
                    null                          // Child setup function
                );
                
                if (!success) {
                    throw new Error(_('Failed to launch transcription process'));
                }
                
                // Set up a timeout to check for the output file
                this._checkTranscriptionResult(outputPath, filePath);
                
            } catch (e) {
                this._notify(_('Error launching transcription: %s').format(e.message.substring(0, 100)));
                this._resetProcessingUI();
                
                // Clean up file on error
                try {
                    GLib.unlink(filePath);
                } catch (e) {
                    // Ignore file cleanup errors
                }
            }
        }
        
        // Reset UI after processing
        _resetProcessingUI() {
            this.icon.icon_name = 'audio-input-microphone-symbolic';
            this.icon.style_class = 'system-status-icon';
            this.recordItem.reactive = true;
        }
        
        // Add debug logging method
        _logDebug(message) {
            log('[Whisper Transcriber] ' + message);
        }
        
        // Check for transcription results
        _checkTranscriptionResult(outputPath, originalFilePath) {
            // Check if the output file exists after a short delay
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                try {
                    // Check if file exists
                    if (GLib.file_test(outputPath, GLib.FileTest.EXISTS)) {
                        // Read the output file
                        let [success, contents] = GLib.file_get_contents(outputPath);
                        
                        if (success && contents && contents.length > 0) {
                            // Convert contents to string
                            const transcription = ByteArray.toString(contents).trim();
                            
                            if (transcription.length > 0) {
                                // Copy to clipboard
                                Clipboard.set_text(CLIPBOARD_TYPE, transcription);
                                
                                // Notify user
                                const truncated = transcription.length > 50 
                                    ? transcription.substring(0, 50) + '...' 
                                    : transcription;
                                this._notify(_('Transcription copied to clipboard: "%s"').format(truncated));
                            } else {
                                this._notify(_('Transcription returned empty result'));
                                
                                // Check for error output
                                this._checkErrorFile();
                            }
                            
                            // Clean up files
                            try {
                                GLib.unlink(outputPath);
                                GLib.unlink(originalFilePath);
                            } catch (e) {
                                // Ignore cleanup errors
                            }
                            
                            // Reset UI
                            this._resetProcessingUI();
                            return GLib.SOURCE_REMOVE; // Stop checking
                        }
                    }
                    
                    // If we reach here, either the file doesn't exist yet or it's empty
                    // Continue checking until timeout (20 seconds max)
                    this._checkCount = (this._checkCount || 0) + 1;
                    
                    if (this._checkCount > 40) { // 40 * 500ms = 20 seconds
                        this._notify(_('Transcription timed out'));
                        this._checkErrorFile();
                        
                        // Clean up
                        try {
                            GLib.unlink(outputPath);
                            GLib.unlink(originalFilePath);
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                        
                        // Reset UI
                        this._resetProcessingUI();
                        return GLib.SOURCE_REMOVE; // Stop checking
                    }
                    
                    return GLib.SOURCE_CONTINUE; // Continue checking
                } catch (e) {
                    this._notify(_('Error checking results: %s').format(e.message.substring(0, 100)));
                    this._resetProcessingUI();
                    return GLib.SOURCE_REMOVE; // Stop checking on error
                }
            });
        }
        
        // Check for error details
        _checkErrorFile() {
            try {
                if (GLib.file_test('/tmp/whisper_error.txt', GLib.FileTest.EXISTS)) {
                    let [success, contents] = GLib.file_get_contents('/tmp/whisper_error.txt');
                    if (success && contents && contents.length > 0) {
                        const errorMsg = ByteArray.toString(contents).trim();
                        this._notify(_('Error details: %s').format(errorMsg.substring(0, 100)));
                        this._logDebug(_('Full error: %s').format(errorMsg));
                    }
                }
            } catch (e) {
                // Ignore errors reading the error file
            }
        }
    }
);

function init() {
    ExtensionUtils.initTranslations(Me.metadata.uuid);
}

function enable() {
    // Load settings
    settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.whisper-transcriber');
    
    // Check dependencies
    const depsAvailable = _checkDependencies();
    
    // Create the indicator
    indicator = new WhisperTranscriberIndicator(depsAvailable);
    
    // Add the indicator to the panel
    Main.panel.addToStatusArea('whisper-transcriber', indicator);
}

function disable() {
    // Stop any ongoing recording
    if (isRecording) {
        try {
            GLib.spawn_sync(null, ['pkill', 'ffmpeg'], null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            // Ignore errors during cleanup
        }
    }
    
    // Remove the indicator from the panel
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
    
    // Clean up settings
    settings = null;
}
