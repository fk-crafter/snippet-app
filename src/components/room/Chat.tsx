import { useState, useEffect, useRef } from 'react'
import usePartySocket from 'partysocket/react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

interface ChatMessage {
  id: string
  user: string
  text: string
  timestamp: number
}

export function Chat({
  username,
  roomId,
}: {
  username: string
  roomId: string
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [isUploadingImage, setIsUploadingImage] = useState(false)

  const [isGifOpen, setIsGifOpen] = useState(false)
  const [gifSearch, setGifSearch] = useState('')
  const [gifs, setGifs] = useState<string[]>([])
  const [isSearchingGifs, setIsSearchingGifs] = useState(false)

  const listEndRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  const PARTY_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'
  const isProd = import.meta.env.PROD

  const socket = usePartySocket({
    host: PARTY_HOST,
    room: roomId,
    protocol: isProd ? 'wss' : 'ws',
    onMessage(event) {
      const data = JSON.parse(event.data)

      if (data.type === 'users-update') {
        setUsers(data.users)
      } else if (data.type === 'chat-history') {
        setMessages(data.messages)
      } else if (data.type === 'chat') {
        setMessages((prev) => [...prev, data.message])
      }
    },
  })

  useEffect(() => {
    const handleOpen = () => {
      socket.send(JSON.stringify({ type: 'user-join', username }))
    }
    if (socket.readyState === 1) {
      handleOpen()
    } else {
      socket.addEventListener('open', handleOpen)
      return () => socket.removeEventListener('open', handleOpen)
    }
  }, [socket, username])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!isGifOpen) return

    const fetchGifs = async () => {
      setIsSearchingGifs(true)
      try {
        const apiKey = import.meta.env.VITE_GIPHY_API_KEY
        if (!apiKey) {
          setGifs([])
          return
        }

        const url = gifSearch.trim()
          ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(gifSearch)}&limit=12&rating=g`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=12&rating=g`

        const res = await fetch(url)
        const data = await res.json()

        if (data.data) {
          setGifs(data.data.map((g: any) => g.images.fixed_height_small.url))
        } else {
          setGifs([])
        }
      } catch (err) {
        setGifs([])
      } finally {
        setIsSearchingGifs(false)
      }
    }

    const timer = setTimeout(() => {
      fetchGifs()
    }, 500)

    return () => clearTimeout(timer)
  }, [isGifOpen, gifSearch])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        setIsGifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    socket.send(JSON.stringify({ type: 'chat', user: username, text: input }))
    setInput('')
  }

  const sendGif = (url: string) => {
    socket.send(
      JSON.stringify({
        type: 'chat',
        user: username,
        text: `__IMG__::${url}`,
      }),
    )
    setIsGifOpen(false)
    setGifSearch('')
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploadingImage(true)
    try {
      const uniqueName = `chat/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`
      const { error } = await supabase.storage
        .from('audios')
        .upload(uniqueName, file)

      if (!error) {
        const { data } = supabase.storage
          .from('audios')
          .getPublicUrl(uniqueName)
        socket.send(
          JSON.stringify({
            type: 'chat',
            user: username,
            text: `__IMG__::${data.publicUrl}`,
          }),
        )
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsUploadingImage(false)
      e.target.value = ''
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-700 bg-stone-800 shadow-lg md:rounded-3xl">
      <div className="flex shrink-0 items-center gap-2 border-b border-stone-700 px-4 py-3">
        <div className="flex h-2 w-2 shrink-0 rounded-full bg-emerald-400"></div>
        <span className="shrink-0 text-xs font-medium text-stone-200 md:text-sm">
          {users.length} en ligne
        </span>
        <span className="ml-auto truncate text-[11px] text-stone-400 md:text-xs">
          {users.join(', ')}
        </span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3 md:p-4">
        {messages.map((msg) => {
          const isMe = msg.user === username
          const isImage = msg.text.startsWith('__IMG__::')
          const imageUrl = isImage ? msg.text.substring(9) : null
          const textContent = isImage ? '' : msg.text

          return (
            <div
              key={msg.id}
              className={`flex w-full flex-col ${isMe ? 'items-end' : 'items-start'}`}
            >
              {!isMe && (
                <span className="mb-0.5 ml-1 text-[11px] font-medium text-stone-400">
                  {msg.user}
                </span>
              )}
              <div
                className={`relative max-w-[85%] wrap-break-words px-3.5 py-2 text-[14px] shadow-sm md:text-[15px] ${
                  isMe
                    ? 'rounded-2xl rounded-tr-sm bg-stone-200 text-stone-900 font-medium'
                    : 'rounded-2xl rounded-tl-sm bg-stone-700 text-stone-100'
                } ${isImage ? 'p-1.5' : ''}`}
              >
                {isImage && imageUrl && (
                  <img
                    src={imageUrl}
                    alt="Contenu partagé"
                    className="max-w-full rounded-xl object-contain"
                    style={{ maxHeight: '250px' }}
                  />
                )}
                {textContent && <span>{textContent}</span>}
              </div>
            </div>
          )
        })}
        <div ref={listEndRef} />
      </div>

      <div
        className="relative shrink-0 border-t border-stone-700 p-2 md:p-3"
        ref={popupRef}
      >
        {isGifOpen && (
          <div className="absolute bottom-[calc(100%+8px)] right-2 z-10 w-64 rounded-2xl border border-stone-700 bg-stone-900 p-3 shadow-2xl md:right-3 md:w-72">
            <div className="mb-2 flex items-center">
              <input
                type="text"
                placeholder="Rechercher un GIF..."
                value={gifSearch}
                onChange={(e) => setGifSearch(e.target.value)}
                className="w-full rounded-xl border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-stone-500"
              />
            </div>
            <div className="grid h-48 grid-cols-2 gap-2 overflow-y-auto pr-1 custom-scrollbar">
              {isSearchingGifs ? (
                <div className="col-span-2 flex h-full items-center justify-center text-xs text-stone-500">
                  Chargement...
                </div>
              ) : gifs.length > 0 ? (
                gifs.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt="GIF"
                    onClick={() => sendGif(url)}
                    className="h-20 w-full cursor-pointer rounded-lg object-cover transition-all hover:scale-105"
                  />
                ))
              ) : (
                <div className="col-span-2 flex h-full items-center justify-center text-xs text-stone-500">
                  Aucun GIF trouvé
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={sendMessage}>
          <div className="flex items-center gap-1.5 rounded-full border border-stone-700 bg-stone-900 p-1 pl-3 transition-all focus-within:border-stone-500 focus-within:ring-4 focus-within:ring-stone-700/50 md:p-1.5 md:pl-4">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                isUploadingImage ? 'Envoi en cours...' : 'Message...'
              }
              disabled={isUploadingImage}
              className="flex-1 bg-transparent text-[16px] text-stone-100 outline-none placeholder:text-stone-500"
            />

            <button
              type="button"
              onClick={() => setIsGifOpen(!isGifOpen)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all md:h-9 md:w-9 ${isGifOpen ? 'bg-stone-700 text-stone-200' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'}`}
            >
              <div className="flex items-center justify-center rounded border-[1.5px] border-current px-0.75 py-px text-[9px] font-bold tracking-wider">
                GIF
              </div>
            </button>

            <label className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-stone-400 transition-all hover:bg-stone-800 hover:text-stone-200 md:h-9 md:w-9">
              <svg
                className="h-4 w-4 md:h-5 md:w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
                />
              </svg>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                disabled={isUploadingImage}
              />
            </label>

            <button
              type="submit"
              disabled={!input.trim() || isUploadingImage}
              className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-900 transition-all hover:bg-stone-100 disabled:opacity-0 active:scale-95 md:h-9 md:w-9"
            >
              <svg
                className="ml-0.5 mb-0.5 h-3.5 w-3.5 -rotate-45 md:h-4 md:w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
