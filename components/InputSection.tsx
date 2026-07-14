import React, { useState, useRef, useEffect } from 'react';
import { ProviderCapabilities, UploadedFile } from '../types';
import { Monitor, StopCircle, Play, X, Trash2, Camera, Film, Upload, FileText, File as FileIcon, Target, AlertCircle, Zap, Settings2, Volume2, VolumeX, Youtube } from 'lucide-react';

interface InputSectionProps {
  onGenerate: (text: string, files: UploadedFile[], customInstructions: string, opts?: { auto?: boolean; youtubeUrl?: string }) => void;
  isGenerating: boolean;
  providerName?: string;
  capabilities?: ProviderCapabilities;
}

type InputMode = 'screen' | 'upload';
type Sensitivity = 'low' | 'medium' | 'high';
type ContentType = 'slides' | 'video';

// In video mode, frames are sampled on a cadence instead of change detection
const VIDEO_FRAME_INTERVAL_MS = 10000;
// Below this pixel-change ratio the picture is considered static (paused)
const VIDEO_STATIC_THRESHOLD = 0.002;

const SENSITIVITY_CONFIG: Record<Sensitivity, { resolution: number; threshold: number; label: string }> = {
  low:    { resolution: 32,  threshold: 0.10, label: 'Low — major changes only' },
  medium: { resolution: 64,  threshold: 0.05, label: 'Medium — balanced' },
  high:   { resolution: 128, threshold: 0.02, label: 'High — catches subtle changes' },
};

const InputSection: React.FC<InputSectionProps> = ({ onGenerate, isGenerating, providerName, capabilities }) => {
  const [mode, setMode] = useState<InputMode>('screen');

  // Screen Capture State
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImages, setCapturedImages] = useState<UploadedFile[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);

  // Auto-Generate State
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [autoGenerateThreshold, setAutoGenerateThreshold] = useState(3);
  const framesSinceLastGenerate = useRef(0);

  // Sensitivity State
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
  const [contentType, setContentType] = useState<ContentType>('slides');
  const [showSettings, setShowSettings] = useState(false);

  // Manual Upload State
  const [manualText, setManualText] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");

  // Custom Instructions State
  const [customInstructions, setCustomInstructions] = useState("");

  // Refs for Capture
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const intervalRef = useRef<number | null>(null);
  // Refs for narration audio (recorded from the shared tab's audio track).
  // Finished segments are kept in pendingAudioRef until the next generation
  // drains them, so audio recorded before "Stop Recording" is never lost.
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pendingAudioRef = useRef<UploadedFile[]>([]);
  const audioFinalizeRef = useRef<Promise<void> | null>(null);
  const [pendingAudioCount, setPendingAudioCount] = useState(0);
  // Refs for auto-generate (to access latest state in interval callback)
  const autoGenerateRef = useRef(autoGenerate);
  const autoGenerateThresholdRef = useRef(autoGenerateThreshold);
  const isGeneratingRef = useRef(isGenerating);
  const capturedImagesRef = useRef(capturedImages);
  const customInstructionsRef = useRef(customInstructions);
  const onGenerateRef = useRef(onGenerate);
  const sensitivityRef = useRef(sensitivity);
  const contentTypeRef = useRef(contentType);
  const streamRef = useRef<MediaStream | null>(null);
  const lastVideoFrameAtRef = useRef(0);

  useEffect(() => { autoGenerateRef.current = autoGenerate; }, [autoGenerate]);
  useEffect(() => { autoGenerateThresholdRef.current = autoGenerateThreshold; }, [autoGenerateThreshold]);
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  useEffect(() => { capturedImagesRef.current = capturedImages; }, [capturedImages]);
  useEffect(() => { customInstructionsRef.current = customInstructions; }, [customInstructions]);
  useEffect(() => { onGenerateRef.current = onGenerate; }, [onGenerate]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { contentTypeRef.current = contentType; }, [contentType]);
  useEffect(() => { streamRef.current = stream; }, [stream]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, []);

  // Attach stream to video element when available
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // --- Screen Capture Logic ---

  const startCapture = async () => {
    setCaptureError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always"
        } as any,
        // With audio requested, the browser offers "Also share tab audio"
        // (tab shares) / system audio (screen shares) — used for narration.
        audio: true
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsRecording(true);
      framesSinceLastGenerate.current = 0;
      startAudioRecording(mediaStream);

      mediaStream.getVideoTracks()[0].onended = () => {
        stopCapture();
      };

      intervalRef.current = window.setInterval(checkForChanges, 2000);
    } catch (err: any) {
      console.error("Error starting screen capture:", err);
      setCaptureError(err.message || "Failed to start screen capture. Please ensure you have granted permission.");
    }
  };

  const startAudioRecording = (mediaStream: MediaStream) => {
    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) {
      setHasAudio(false);
      return;
    }
    try {
      // Low bitrate keeps long segments well under Gemini's 20 MB inline
      // request cap (~0.25 MB/min); narration doesn't need more.
      const recorder = new MediaRecorder(new MediaStream(audioTracks), {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 32000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start();
      audioRecorderRef.current = recorder;
      setHasAudio(true);
    } catch (err) {
      console.warn("Audio recording unavailable:", err);
      setHasAudio(false);
    }
  };

  // Stop the active recorder and package what it recorded into a pending
  // segment. The returned promise resolves once the segment is stored.
  const finalizeCurrentRecording = (): Promise<void> => {
    const recorder = audioRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return audioFinalizeRef.current ?? Promise.resolve();
    }
    audioRecorderRef.current = null;
    const finalize = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size === 0) {
          resolve();
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          pendingAudioRef.current.push({
            id: Date.now().toString() + Math.random(),
            data: reader.result as string,
            mimeType: 'audio/webm',
          });
          setPendingAudioCount(pendingAudioRef.current.length);
          resolve();
        };
        reader.readAsDataURL(blob);
      };
      recorder.stop();
    });
    audioFinalizeRef.current = finalize;
    return finalize;
  };

  // Cut the audio recorded since the last generation into a pending segment
  // and keep recording the next one.
  const cutAudioSegment = async (): Promise<void> => {
    const recorder = audioRecorderRef.current;
    const audioStream = recorder && recorder.state !== 'inactive' ? recorder.stream : null;
    await finalizeCurrentRecording();
    if (audioStream && audioStream.getAudioTracks()[0]?.readyState === 'live') {
      startAudioRecording(audioStream);
    }
  };

  // Hand all pending segments to a generation and clear the buffer.
  const drainPendingAudio = async (): Promise<UploadedFile[]> => {
    if (audioFinalizeRef.current) await audioFinalizeRef.current;
    const segments = pendingAudioRef.current;
    pendingAudioRef.current = [];
    setPendingAudioCount(0);
    return segments;
  };

  const stopCapture = () => {
    // Keep the recorded audio: package it into a pending segment so a
    // generate after "Stop Recording" still includes the narration.
    finalizeCurrentRecording();
    setHasAudio(false);
    // Read the stream from a ref: the unmount cleanup effect captures the
    // first-render closure, where the `stream` state is still null.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRecording(false);
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const base64String = canvas.toDataURL('image/jpeg', 0.8);

    const newImage: UploadedFile = {
      id: Date.now().toString(),
      data: base64String,
      mimeType: 'image/jpeg'
    };

    setCapturedImages(prev => {
      const updated = [...prev, newImage];
      // Auto-clear old frames if over 20 and auto-generate is on
      if (autoGenerateRef.current && updated.length > 20) {
        return updated.slice(-10);
      }
      return updated;
    });

    // Auto-generate logic
    framesSinceLastGenerate.current++;
    if (
      autoGenerateRef.current &&
      !isGeneratingRef.current &&
      framesSinceLastGenerate.current >= autoGenerateThresholdRef.current
    ) {
      framesSinceLastGenerate.current = 0;
      // Use a timeout to let the state update with the new image first
      setTimeout(async () => {
        await cutAudioSegment();
        const audio = await drainPendingAudio();
        onGenerateRef.current(
          "",
          [...capturedImagesRef.current, ...audio],
          customInstructionsRef.current,
          { auto: true }
        );
      }, 100);
    }

    return base64String;
  };

  const checkForChanges = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const config = SENSITIVITY_CONFIG[sensitivityRef.current];
    const res = config.resolution;

    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = res;
    diffCanvas.height = res;
    const ctx = diffCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0, res, res);
    const imageData = ctx.getImageData(0, 0, res, res);
    const currentPixels = imageData.data;

    if (!lastFrameDataRef.current) {
      lastFrameDataRef.current = new Uint8ClampedArray(currentPixels);
      lastVideoFrameAtRef.current = Date.now();
      captureFrame();
      return;
    }

    // Compute pixel-change ratio
    const totalPixels = res * res;
    let changedPixels = 0;
    const prev = lastFrameDataRef.current;
    for (let i = 0; i < currentPixels.length; i += 4) {
      const dr = Math.abs(currentPixels[i] - prev[i]);
      const dg = Math.abs(currentPixels[i + 1] - prev[i + 1]);
      const db = Math.abs(currentPixels[i + 2] - prev[i + 2]);
      // A pixel is "changed" if the average color shift exceeds a threshold
      if ((dr + dg + db) / 3 > 30) {
        changedPixels++;
      }
    }

    const changeRatio = changedPixels / totalPixels;

    if (contentTypeRef.current === 'video') {
      // Video changes almost every check, so change detection would flood the
      // timeline — sample on a cadence instead, skipping only when the
      // picture is static (paused playback).
      const now = Date.now();
      if (now - lastVideoFrameAtRef.current >= VIDEO_FRAME_INTERVAL_MS && changeRatio > VIDEO_STATIC_THRESHOLD) {
        captureFrame();
        lastFrameDataRef.current = new Uint8ClampedArray(currentPixels);
        lastVideoFrameAtRef.current = now;
      }
      return;
    }

    if (changeRatio > config.threshold) {
      captureFrame();
      lastFrameDataRef.current = new Uint8ClampedArray(currentPixels);
    }
  };

  // --- Manual Upload Logic ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach((file: File) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          setUploadedFiles(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            data: base64String,
            mimeType: file.type
          }]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  // --- Common Logic ---

  const removeFile = (id: string, isCapture: boolean) => {
    if (isCapture) {
      setCapturedImages(prev => prev.filter(f => f.id !== id));
    } else {
      setUploadedFiles(prev => prev.filter(f => f.id !== id));
    }
  };

  const handleGenerateClick = async () => {
    if (mode === 'screen') {
      stopCapture();
      const audio = await drainPendingAudio();
      onGenerate("", [...capturedImages, ...audio], customInstructions);
    } else {
      stopCapture();
      onGenerate(manualText, uploadedFiles, customInstructions, {
        youtubeUrl: youtubeUrl.trim() || undefined,
      });
    }
  };

  const isGenerateDisabled = () => {
    if (isGenerating) return true;
    if (mode === 'screen') return capturedImages.length === 0 && pendingAudioCount === 0;
    if (mode === 'upload') return manualText.trim().length === 0 && uploadedFiles.length === 0 && youtubeUrl.trim().length === 0;
    return true;
  };

  const switchMode = (newMode: InputMode) => {
    if (isRecording) stopCapture();
    setMode(newMode);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Mode Tabs */}
      <div className="flex p-1 bg-slate-200 rounded-xl w-fit mx-auto mb-6">
        <button
          onClick={() => switchMode('screen')}
          className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'screen'
              ? 'bg-white text-indigo-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <Monitor size={16} /> Live Capture
        </button>
        <button
          onClick={() => switchMode('upload')}
          className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'upload'
              ? 'bg-white text-indigo-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <Upload size={16} /> Upload & Paste
        </button>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {captureError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-700 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Screen Capture Error</p>
            <p className="text-sm opacity-90">{captureError}</p>
          </div>
          <button onClick={() => setCaptureError(null)} className="text-red-400 hover:text-red-600">
            <X size={18} />
          </button>
        </div>
      )}

      {/* === SCREEN CAPTURE UI === */}
      {mode === 'screen' && (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Monitor className="text-indigo-600" size={20} />
                <h2 className="font-semibold text-slate-700">Screen Reader</h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Auto-Generate Toggle */}
                {isRecording && (
                  <button
                    onClick={() => setAutoGenerate(!autoGenerate)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                      autoGenerate
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                    }`}
                    title={autoGenerate ? `Auto-generating every ${autoGenerateThreshold} frames` : 'Enable auto-generate'}
                  >
                    <Zap size={12} className={autoGenerate ? 'text-amber-500' : ''} />
                    {autoGenerate ? (
                      <>
                        Auto
                        {isGenerating && (
                          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-500 rounded-full animate-spin" />
                        )}
                      </>
                    ) : 'Auto'}
                  </button>
                )}

                {/* Settings Toggle */}
                {isRecording && (
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      showSettings ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                    }`}
                    title="Capture settings"
                  >
                    <Settings2 size={16} />
                  </button>
                )}

                {isRecording && (
                  hasAudio ? (
                    capabilities && !capabilities.audio ? (
                      <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium" title={`${providerName ?? 'The active provider'} can't process audio — narration will be ignored. Switch to Gemini in Settings to include it.`}>
                        <Volume2 size={12} />
                        Audio unused
                      </div>
                    ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium" title="Narration audio is being captured">
                      <Volume2 size={12} />
                      Audio on
                    </div>
                    )
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-xs font-medium" title='No audio captured — share a browser tab and tick "Also share tab audio"'>
                      <VolumeX size={12} />
                      No audio
                    </div>
                  )
                )}

                {isRecording && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-red-100 text-red-600 rounded-full text-xs font-medium animate-pulse">
                    <div className="w-2 h-2 bg-red-500 rounded-full" />
                    Recording Source
                  </div>
                )}
              </div>
            </div>

            {/* Settings Panel */}
            {showSettings && isRecording && (
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-4 text-sm animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2">
                  <label className="text-slate-600 font-medium">Content type:</label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as ContentType)}
                    className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <option value="slides">Slides / documents</option>
                    <option value="video">Video</option>
                  </select>
                  {contentType === 'video' && (
                    <span className="text-xs text-slate-400">Samples a frame every {VIDEO_FRAME_INTERVAL_MS / 1000}s while playing</span>
                  )}
                </div>
                {contentType === 'slides' && (
                <div className="flex items-center gap-2">
                  <label className="text-slate-600 font-medium">Sensitivity:</label>
                  <select
                    value={sensitivity}
                    onChange={(e) => setSensitivity(e.target.value as Sensitivity)}
                    className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <span className="text-xs text-slate-400">{SENSITIVITY_CONFIG[sensitivity].label}</span>
                </div>
                )}
                {autoGenerate && (
                  <div className="flex items-center gap-2">
                    <label className="text-slate-600 font-medium">Auto every:</label>
                    <select
                      value={autoGenerateThreshold}
                      onChange={(e) => setAutoGenerateThreshold(Number(e.target.value))}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                      <option value={3}>3 frames</option>
                      <option value={5}>5 frames</option>
                      <option value={10}>10 frames</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="relative bg-slate-900 aspect-video flex items-center justify-center overflow-hidden group">
              {stream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-center p-8">
                  <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Monitor className="text-slate-500" size={32} />
                  </div>
                  <h3 className="text-slate-200 font-medium mb-2">Share your course material</h3>
                  <p className="text-slate-400 text-sm max-w-md mx-auto mb-6">
                    We'll monitor your screen and automatically capture slides, pages, or notes as you read through them.
                  </p>
                  <button
                    onClick={startCapture}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-all shadow-lg hover:shadow-indigo-500/25"
                  >
                    <Play size={18} fill="currentColor" />
                    Start Study Session
                  </button>
                </div>
              )}

              {isRecording && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4">
                  <button
                    onClick={captureFrame}
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-lg text-sm font-medium transition-colors border border-white/10"
                  >
                    <Camera size={16} />
                    Snap Now
                  </button>
                  <button
                    onClick={stopCapture}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/80 hover:bg-red-600/90 backdrop-blur-md text-white rounded-lg text-sm font-medium transition-colors shadow-lg"
                  >
                    <StopCircle size={16} />
                    Stop Recording
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Timeline for Screen Mode */}
          {(capturedImages.length > 0 || pendingAudioCount > 0 || isRecording) && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Film size={16} className="text-slate-400" />
                  Captured Timeline <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{capturedImages.length} frames</span>
                  {pendingAudioCount > 0 && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1" title="Recorded narration that will be included in the next generation">
                      <Volume2 size={10} /> {pendingAudioCount} audio segment{pendingAudioCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-3">
                  {capturedImages.length > 20 && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      Many frames — consider generating
                    </span>
                  )}
                  {(capturedImages.length > 0 || pendingAudioCount > 0) && (
                    <button
                      onClick={() => {
                        setCapturedImages([]);
                        framesSinceLastGenerate.current = 0;
                        pendingAudioRef.current = [];
                        setPendingAudioCount(0);
                      }}
                      className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                    >
                      <Trash2 size={12} /> Clear all
                    </button>
                  )}
                </div>
              </div>

              {capturedImages.length === 0 ? (
                <div className="h-32 border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center text-slate-400 text-sm bg-slate-50/50">
                    <p>Waiting for content...</p>
                    <p className="text-xs opacity-70 mt-1">Navigate through your material to auto-capture</p>
                </div>
              ) : (
                <div className="flex gap-4 overflow-x-auto pb-4 pt-1 px-1 snap-x">
                    {capturedImages.map((img, index) => (
                    <div key={img.id} className="relative flex-shrink-0 w-48 aspect-video group snap-center">
                        <img
                          src={img.data}
                          alt={`Capture ${index + 1}`}
                          className="w-full h-full object-cover rounded-lg border border-slate-200 shadow-sm"
                        />
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                onClick={() => removeFile(img.id, true)}
                                className="bg-black/50 hover:bg-black/70 text-white p-1 rounded-full backdrop-blur-sm"
                            >
                                <X size={12} />
                            </button>
                        </div>
                        <div className="absolute bottom-1 right-1 bg-black/50 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded">
                            #{index + 1}
                        </div>
                    </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* === MANUAL UPLOAD UI === */}
      {mode === 'upload' && (
        <>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3 text-slate-700 font-medium">
            <Youtube size={18} className="text-red-500" />
            <h3>YouTube Video <span className="text-slate-400 font-normal text-sm">(Optional)</span></h3>
          </div>
          <input
            type="url"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="https://www.youtube.com/watch?v=..."
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            disabled={capabilities ? !capabilities.youtube : false}
          />
          <p className="text-xs text-slate-400 mt-2">
            {capabilities && !capabilities.youtube
              ? `Not supported by ${providerName ?? 'the active provider'} — switch to Gemini in Settings (gear icon) to use YouTube links.`
              : "Paste a link to a public YouTube video — we'll analyze its visuals and narration directly."}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Text Input */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col h-[400px]">
             <div className="flex items-center gap-2 mb-3 text-slate-700 font-medium">
               <FileText size={18} />
               <h3>Paste Text Notes</h3>
             </div>
             <textarea
               className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
               placeholder="Paste lecture notes, articles, or summaries here..."
               value={manualText}
               onChange={(e) => setManualText(e.target.value)}
             />
          </div>

          {/* File Upload */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col h-[400px]">
             <div className="flex items-center gap-2 mb-3 text-slate-700 font-medium">
               <Upload size={18} />
               <h3>Upload Files (PDF/Images)</h3>
             </div>

             <div className="flex-1 relative border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors flex flex-col items-center justify-center text-center p-6 group">
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Upload size={24} />
                </div>
                <p className="text-slate-700 font-medium">Click to upload or drag & drop</p>
                <p className="text-xs text-slate-500 mt-1">PDF documents, Screenshots, Diagrams</p>
             </div>

             {/* File List */}
             {uploadedFiles.length > 0 && (
               <div className="mt-4 h-32 overflow-y-auto pr-2 space-y-2">
                 {uploadedFiles.map((file) => (
                   <div key={file.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 p-2 rounded-lg">
                      <div className="flex items-center gap-2 overflow-hidden">
                        {file.mimeType.includes('image') ? (
                          <img src={file.data} alt="thumb" className="w-8 h-8 rounded object-cover bg-white" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                            <FileIcon size={14} />
                          </div>
                        )}
                        <span className="text-xs text-slate-600 truncate max-w-[150px]">
                          {file.mimeType.includes('pdf') ? 'Document.pdf' : 'Image'}
                        </span>
                      </div>
                      <button
                        onClick={() => removeFile(file.id, false)}
                        className="text-slate-400 hover:text-red-500 p-1"
                      >
                        <X size={14} />
                      </button>
                   </div>
                 ))}
               </div>
             )}
          </div>
        </div>
        </>
      )}

      {/* === CUSTOM GOALS / INSTRUCTIONS === */}
      <div className="bg-gradient-to-r from-slate-50 to-white rounded-2xl shadow-sm border border-slate-200 p-4">
         <div className="flex items-center gap-2 mb-3 text-slate-700 font-medium">
           <Target size={18} className="text-indigo-600" />
           <h3>Learning Goal / Focus Area <span className="text-slate-400 font-normal text-sm">(Optional)</span></h3>
         </div>
         <div className="relative">
             <textarea
               className="w-full bg-white border border-slate-200 rounded-xl p-4 pr-12 resize-none h-20 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm"
               placeholder="e.g., Focus on Cisco configuration commands, or Extract all definitions regarding cellular respiration..."
               value={customInstructions}
               onChange={(e) => setCustomInstructions(e.target.value)}
             />
         </div>
         <p className="text-xs text-slate-400 mt-2">
            Providing a specific goal helps the AI capture exactly what matters to you.
         </p>
      </div>

      {/* Generate Action */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleGenerateClick}
          disabled={isGenerateDisabled()}
          className={`flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-white transition-all shadow-md text-lg
            ${isGenerateDisabled()
              ? 'bg-slate-300 cursor-not-allowed text-slate-500'
              : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]'
            }`}
        >
          {isGenerating ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing...
            </>
          ) : (
            <>
              Generate Study Material
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default InputSection;
