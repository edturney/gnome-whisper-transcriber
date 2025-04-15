// GNOME Extension: Whisper Transcriber
// Description: Records audio, transcribes it using OpenAI Whisper API, and copies to clipboard

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// Extension state
let indicator = null;
let isRecording = false;
let recordingPath = '';
let recordingProcess = null;
let settings = null;

// API key settings key
const API_KEY_SETTING = 'whisper-api-key';
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const WhisperTranscriberIndicator = GObject.registerClass(
    class WhisperTranscriberIndicator extends PanelMenu.Button {
        _init(depsAvailable) {
            super._init(0.0, _('Whisper Transcriber'));
            
            this._depsAvailable = depsAvailable;
            this._checkCount = 0;
            
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
            // Launch preferences
            if (this._extension) {
                this._extension.openPreferences();
            }
        }
        
        setExtension(extension) {
            this._extension = extension;
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
                
                let spawnResult = GLib.spawn_async(
                    null,           // Working directory (null = default)
                    ffmpegArgs,     // Arguments
                    null,           // Environment variables (null = inherit)
                    GLib.SpawnFlags.SEARCH_PATH,  // Use PATH to find executable
                    null            // Child setup function
                );

                let success = spawnResult[0];
                let pid = spawnResult[1];
                
                if (success) {
                    recordingProcess = pid;
                } else {
                    throw new Error("Failed to start recording process");
                }
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

            this._waitForFileCompletion(recordingPath, 0);
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
                let spawnResult = GLib.spawn_async(
                    null,                         // Working directory
                    ['bash', '-c', command],      // Command
                    null,                         // Environment
                    GLib.SpawnFlags.SEARCH_PATH,  // Flags
                    null                          // Child setup function
                );
                
                let success = spawnResult[0];
                
                if (!success) {
                    throw new Error(_('Failed to launch transcription process'));
                }
                
                // Set up a timeout to check for the output file
                this._checkCount = 0;  // Reset counter
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
            console.log('[Whisper Transcriber] ' + message);
        }
        
        // Check for transcription results
        _checkTranscriptionResult(outputPath, originalFilePath) {
            // Check if the output file exists after a short delay
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                try {
                    // Check if file exists
                    if (GLib.file_test(outputPath, GLib.FileTest.EXISTS)) {
                        // Read the output file
                        let fileContents = GLib.file_get_contents(outputPath);
                        let success = fileContents[0];
                        let contents = fileContents[1];
                        
                        if (success && contents && contents.length > 0) {
                            // Convert contents to string
                            const decoder = new TextDecoder('utf-8');
                            const transcription = decoder.decode(contents).trim();
                            
                            if (transcription.length > 0) {
                                // Copy to clipboard
                                St.Clipboard.get_default().set_text(CLIPBOARD_TYPE, transcription);
                                
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
                    this._checkCount++;
                    
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
                    let fileContents = GLib.file_get_contents('/tmp/whisper_error.txt');
                    let success = fileContents[0];
                    let contents = fileContents[1];
                    
                    if (success && contents && contents.length > 0) {
                        const decoder = new TextDecoder('utf-8');
                        const errorMsg = decoder.decode(contents).trim();
                        this._notify(_('Error details: %s').format(errorMsg.substring(0, 100)));
                        this._logDebug(_('Full error: %s').format(errorMsg));
                    }
                }
            } catch (e) {
                // Ignore errors reading the error file
            }
        }
        _waitForFileCompletion(filePath, attempts) {
            const MAX_ATTEMPTS = 20; // Maximum number of attempts (10 seconds total)
            
            if (attempts >= MAX_ATTEMPTS) {
                this._logDebug('Timeout waiting for file to be finalized');
                this._resetUI();
                this._processAudio(filePath); // Try processing anyway
                return;
            }
            
            // Check if file exists and has size
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                try {
                    if (GLib.file_test(filePath, GLib.FileTest.EXISTS)) {
                        // Get file info to check size
                        const file = Gio.File.new_for_path(filePath);
                        const info = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                        const fileSize = info.get_size();
                        
                        this._logDebug(`File size: ${fileSize} bytes`);
                        
                        if (fileSize > 0) {
                            // File exists and has content
                            this._logDebug('File finalized successfully');
                            this._resetUI();
                            this._processAudio(filePath);
                            return GLib.SOURCE_REMOVE;
                        }
                    }
                    
                    // File doesn't exist or has no content yet, try again
                    this._logDebug(`Waiting for file to be finalized, attempt ${attempts + 1}/${MAX_ATTEMPTS}`);
                    this._waitForFileCompletion(filePath, attempts + 1);
                    
                } catch (e) {
                    this._logDebug(`Error checking file: ${e.message}`);
                    // Continue waiting despite error
                    this._waitForFileCompletion(filePath, attempts + 1);
                }
                
                return GLib.SOURCE_REMOVE;
            });
        }
    }
);

export default class WhisperTranscriberExtension extends Extension {
    enable() {
        console.log('Enabling Whisper Transcriber extension');
        
        // Load settings
        settings = this.getSettings();
               
        // Create the indicator
        indicator = new WhisperTranscriberIndicator(depsAvailable);
        indicator.setExtension(this);
        
        // Add the indicator to the panel
        Main.panel.addToStatusArea('whisper-transcriber', indicator);
    }

    disable() {
        console.log('Disabling Whisper Transcriber extension');
        
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
}
