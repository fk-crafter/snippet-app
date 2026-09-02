import { useEffect, useRef, useState } from 'react'
import usePartySocket from 'partysocket/react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

export function AudioPlayer({ roomId }: { roomId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  const pendingSyncRef = useRef(false)
  const isDraggingRef = useRef(false)

  const PARTY_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'
  const isProd = import.meta.env.PROD

  const socket = usePartySocket({
    host: PARTY_HOST,
    room: roomId,
    protocol: isProd ? 'wss' : 'ws',
    onMessage(event) {
      const data = JSON.parse(event.data)

      if (data.type === 'audio-upload-start') {
        setFileName(data.name)
        setIsUploading(true)
        setUploadProgress(0)
        setAudioSrc(null)
      }

      if (data.type === 'audio-loaded') {
        setAudioSrc(data.url)
        setFileName(data.name)
        setCurrentTime(0)
        setDuration(0)
        setIsPlaying(false)
        setIsUploading(false)
        setUploadProgress(null)
        pendingSyncRef.current = true
      }

      if (data.type === 'audio-action' && audioRef.current) {
        if (data.time !== undefined) {
          if (Math.abs(audioRef.current.currentTime - data.time) > 0.5) {
            audioRef.current.currentTime = data.time
            if (!isDraggingRef.current) {
              setCurrentTime(data.time)
            }
          }
        }
        if (data.action === 'play') {
          audioRef.current.play().catch(() => {})
        } else if (data.action === 'pause') {
          audioRef.current.pause()
        }
      }

      if (data.type === 'audio-seek' && audioRef.current) {
        audioRef.current.currentTime = data.time
        if (!isDraggingRef.current) {
          setCurrentTime(data.time)
        }
      }

      if (data.type === 'audio-clear') {
        setAudioSrc(null)
        setFileName(null)
        setIsPlaying(false)
        setCurrentTime(0)
        setDuration(0)
        setIsUploading(false)
        setUploadProgress(null)
        pendingSyncRef.current = false
      }
    },
  })

  useEffect(() => {
    const handleOpen = () => {
      socket.send(JSON.stringify({ type: 'request-audio-state' }))
    }
    if (socket.readyState === 1) {
      handleOpen()
    } else {
      socket.addEventListener('open', handleOpen)
      return () => socket.removeEventListener('open', handleOpen)
    }
  }, [socket])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setUploadProgress(25)
    socket.send(JSON.stringify({ type: 'audio-upload-start', name: file.name }))

    try {
      const uniqueName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`

      setUploadProgress(50)

      const { error } = await supabase.storage
        .from('audios')
        .upload(uniqueName, file)

      if (error) throw error

      setUploadProgress(75)

      const { data: publicUrlData } = supabase.storage
        .from('audios')
        .getPublicUrl(uniqueName)

      const url = publicUrlData.publicUrl

      setAudioSrc(url)
      setFileName(file.name)
      setCurrentTime(0)
      setDuration(0)
      setIsPlaying(false)
      setIsUploading(false)
      setUploadProgress(null)
      pendingSyncRef.current = true

      socket.send(
        JSON.stringify({
          type: 'audio-loaded',
          name: file.name,
          url: url,
        }),
      )
    } catch (error) {
      console.error(error)
      setIsUploading(false)
      setUploadProgress(null)
    } finally {
      e.target.value = ''
    }
  }

  const handlePlayPause = (shouldPlay: boolean) => {
    if (audioRef.current && audioSrc) {
      if (shouldPlay) audioRef.current.play().catch(() => {})
      else audioRef.current.pause()

      setIsPlaying(shouldPlay)
      socket.send(
        JSON.stringify({
          type: 'audio-action',
          action: shouldPlay ? 'play' : 'pause',
          time: audioRef.current.currentTime,
        }),
      )
    }
  }

  const handleClearAudio = () => {
    setAudioSrc(null)
    setFileName(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    socket.send(JSON.stringify({ type: 'audio-clear' }))
  }

  const handleTimeUpdate = () => {
    if (audioRef.current && !isDraggingRef.current)
      setCurrentTime(audioRef.current.currentTime)
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration)
  }

  const handleCanPlay = () => {
    if (pendingSyncRef.current) {
      pendingSyncRef.current = false
      socket.send(JSON.stringify({ type: 'audio-request-sync' }))
    }
  }

  const handleSeekStart = () => {
    isDraggingRef.current = true
  }

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value)
    setCurrentTime(newTime)
    if (audioRef.current && audioSrc) audioRef.current.currentTime = newTime
  }

  const handleSeekEnd = () => {
    isDraggingRef.current = false
    if (audioRef.current && audioSrc) {
      socket.send(
        JSON.stringify({
          type: 'audio-seek',
          time: audioRef.current.currentTime,
        }),
      )
    }
  }

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return '0:00'
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
  }

  return (
    <div className="relative overflow-hidden flex flex-col gap-3 rounded-2xl border border-stone-700 bg-stone-800 p-3 shadow-lg md:gap-5 md:rounded-3xl md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            onClick={() => handlePlayPause(!isPlaying)}
            disabled={!audioSrc || isUploading}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all md:h-14 md:w-14 ${
              audioSrc && !isUploading
                ? 'cursor-pointer bg-stone-200 text-stone-900 shadow-md hover:bg-stone-100 active:scale-95'
                : 'bg-stone-700 text-stone-500'
            }`}
          >
            {isPlaying ? (
              <svg
                className="h-5 w-5 md:h-6 md:w-6"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  fillRule="evenodd"
                  d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg
                className="ml-0.5 h-5 w-5 md:ml-1 md:h-6 md:w-6"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  fillRule="evenodd"
                  d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-stone-100 md:text-base">
                {fileName || 'Aucun fichier sélectionné'}
              </h3>
              {audioSrc && !isUploading && (
                <button
                  onClick={handleClearAudio}
                  className="shrink-0 rounded-full p-1 text-stone-400 transition-colors hover:bg-stone-700 hover:text-red-400"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
            <p className="truncate mt-0.5 text-xs text-stone-300">
              {isUploading
                ? 'Envoi et synchronisation en cours...'
                : audioSrc
                  ? 'Prêt pour la lecture'
                  : 'En attente...'}
            </p>
          </div>
        </div>

        <label
          className={`shrink-0 cursor-pointer rounded-full px-3 py-2 text-xs font-medium transition-colors md:px-5 md:py-2.5 md:text-sm ${
            isUploading
              ? 'bg-stone-700 text-stone-500 cursor-not-allowed'
              : 'bg-stone-700 text-stone-200 hover:bg-stone-600'
          }`}
        >
          <span className="hidden sm:inline">Uploader un fichier</span>
          <span className="sm:hidden">Uploader</span>
          <input
            type="file"
            accept="audio/mp3,audio/*"
            className="hidden"
            onChange={handleFileUpload}
            disabled={isUploading}
          />
        </label>
      </div>

      {audioSrc && !isUploading && (
        <div className="flex w-full flex-col gap-1.5 md:gap-2">
          <div className="relative flex w-full items-center">
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime}
              onPointerDown={handleSeekStart}
              onChange={handleSeekChange}
              onPointerUp={handleSeekEnd}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-stone-700 accent-stone-200 focus:outline-none"
              style={{
                background: `linear-gradient(to right, #e7e5e4 0%, #e7e5e4 ${
                  duration ? (currentTime / duration) * 100 : 0
                }%, #44403c ${duration ? (currentTime / duration) * 100 : 0}%, #44403c 100%)`,
              }}
            />
          </div>
          <div className="flex items-center justify-between px-0.5 text-[10px] font-medium text-stone-400 md:text-xs">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}

      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={handleCanPlay}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {uploadProgress !== null && (
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-stone-700">
          <div
            className="h-full bg-stone-200 transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          ></div>
        </div>
      )}
    </div>
  )
}
