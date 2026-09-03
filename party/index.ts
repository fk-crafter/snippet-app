import type * as Party from 'partykit/server'

interface AudioState {
  url: string | null
  name: string | null
  isPlaying: boolean
  currentTime: number
  lastUpdateTime: number
}

interface ChatMessage {
  id: string
  user: string
  text: string
  timestamp: number
}

export default class AudioSyncServer implements Party.Server {
  audioState: AudioState = {
    url: null,
    name: null,
    isPlaying: false,
    currentTime: 0,
    lastUpdateTime: 0,
  }

  users = new Map<string, string>()
  chatHistory: ChatMessage[] = []

  constructor(readonly room: Party.Room) {}

  async onRequest(req: Party.Request) {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-file-name',
        },
      })
    }

    if (req.method === 'POST') {
      try {
        const fileName = req.headers.get('x-file-name') || 'audio.mp3'
        const decodedName = decodeURIComponent(fileName).replace(
          /[^a-zA-Z0-9.-]/g,
          '_',
        )

        const token = (this.room.env.VITE_BLOB_READ_WRITE_TOKEN ||
          this.room.env.BLOB_READ_WRITE_TOKEN) as string

        if (!token) {
          return new Response(
            JSON.stringify({ error: 'Token Vercel manquant sur le serveur' }),
            {
              status: 500,
              headers: { 'Access-Control-Allow-Origin': '*' },
            },
          )
        }

        const body = await req.arrayBuffer()

        const res = await fetch(
          `https://blob.vercel-storage.com/${Date.now()}-${decodedName}`,
          {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${token}`,
            },
            body: body,
          },
        )

        const data = await res.json()

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        })
      } catch (error) {
        console.error('Upload error:', error)
        return new Response(
          JSON.stringify({ error: "Erreur lors de l'upload vers le Cloud" }),
          {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
          },
        )
      }
    }

    return new Response('Not found', { status: 404 })
  }

  onClose(connection: Party.Connection) {
    if (this.users.has(connection.id)) {
      this.users.delete(connection.id)
      this.broadcastUsers()
    }
  }

  broadcastUsers() {
    const uniqueUsers = Array.from(new Set(this.users.values()))
    this.room.broadcast(
      JSON.stringify({
        type: 'users-update',
        users: uniqueUsers,
      }),
    )
  }

  onMessage(message: string, sender: Party.Connection) {
    const data = JSON.parse(message)

    if (data.type === 'user-join') {
      this.users.set(sender.id, data.username)
      this.broadcastUsers()

      sender.send(
        JSON.stringify({
          type: 'chat-history',
          messages: this.chatHistory,
        }),
      )
    } else if (data.type === 'chat') {
      const chatMsg: ChatMessage = {
        id: crypto.randomUUID(),
        user: data.user,
        text: data.text,
        timestamp: Date.now(),
      }
      this.chatHistory.push(chatMsg)
      if (this.chatHistory.length > 100) this.chatHistory.shift()
      this.room.broadcast(JSON.stringify({ type: 'chat', message: chatMsg }))
    } else if (
      data.type === 'audio-upload-start' ||
      data.type === 'audio-upload-progress'
    ) {
      this.room.broadcast(message, [sender.id])
    } else if (data.type === 'audio-loaded') {
      this.audioState.url = data.url
      this.audioState.name = data.name
      this.audioState.isPlaying = false
      this.audioState.currentTime = 0
      this.audioState.lastUpdateTime = Date.now()
      this.room.broadcast(message, [sender.id])
    } else if (data.type === 'audio-action') {
      this.audioState.isPlaying = data.action === 'play'
      if (data.time !== undefined) {
        this.audioState.currentTime = data.time
      }
      this.audioState.lastUpdateTime = Date.now()
      this.room.broadcast(message, [sender.id])
    } else if (data.type === 'audio-seek') {
      this.audioState.currentTime = data.time
      this.audioState.lastUpdateTime = Date.now()
      this.room.broadcast(message, [sender.id])
    } else if (data.type === 'audio-clear') {
      this.audioState = {
        url: null,
        name: null,
        isPlaying: false,
        currentTime: 0,
        lastUpdateTime: 0,
      }
      this.room.broadcast(message, [sender.id])
    } else if (data.type === 'audio-request-sync') {
      if (!this.audioState.url) return

      let currentSyncTime = this.audioState.currentTime
      if (this.audioState.isPlaying) {
        currentSyncTime += (Date.now() - this.audioState.lastUpdateTime) / 1000
      }
      sender.send(
        JSON.stringify({
          type: 'audio-action',
          action: this.audioState.isPlaying ? 'play' : 'pause',
          time: currentSyncTime,
        }),
      )
    } else if (data.type === 'request-audio-state') {
      if (this.audioState.url) {
        sender.send(
          JSON.stringify({
            type: 'audio-loaded',
            url: this.audioState.url,
            name: this.audioState.name,
          })
        )
      }
    }
  }
}
