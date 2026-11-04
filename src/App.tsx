import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'success' | 'error'>('checking')
  const [statusMessage, setStatusMessage] = useState<string>('Testing connection to Supabase...')

  useEffect(() => {
    async function testSupabaseConnection() {
      try {
        const { error } = await supabase.auth.getSession()
        
        if (error) {
          setConnectionStatus('error')
          setStatusMessage(`Connection failed: ${error.message}`)
        } else {
          setConnectionStatus('success')
          setStatusMessage('Successfully connected to Supabase!')
        }
      } catch (err: unknown) {
        setConnectionStatus('error')
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
        setStatusMessage(`Unexpected error: ${errorMessage}`)
      }
    }

    testSupabaseConnection()
  }, [])

  return (
    <main className="container">
      <h1>Curio</h1>
      <p className="tagline">From scattered curiosity to connected understanding.</p>
      <p className="welcome">Your space to explore, understand and connect ideas.</p>

      <div className={`connection-badge ${connectionStatus}`}>
        <strong>Supabase Status:</strong> {statusMessage}
      </div>
    </main>
  )
}

export default App