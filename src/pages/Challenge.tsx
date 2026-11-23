
import { Link } from 'react-router-dom'

export function Challenge() {
  return (
    <div style={{
      minHeight: '70vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: '480px',
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-flex',
          padding: '10px 18px',
          borderRadius: '999px',
          background: '#F1ECFF',
          color: '#6941C6',
          fontSize: '13px',
          fontWeight: 600,
          marginBottom: '24px',
        }}>
          Coming Soon
        </div>

        <div style={{
          fontSize: '48px',
          marginBottom: '16px',
        }}>
          ✦
        </div>

        <h1 style={{
          fontSize: '32px',
          fontWeight: 700,
          color: '#211B35',
          marginBottom: '16px',
        }}>
          Challenge your thinking
        </h1>

        <p style={{
          color: '#777085',
          fontSize: '16px',
          lineHeight: 1.8,
          marginBottom: '28px',
        }}>
          Go beyond understanding. Question your assumptions,
          explore different perspectives, and discover new ways
          to think about what you've learned.
        </p>

        <p style={{
          color: '#6941C6',
          fontSize: '14px',
          fontWeight: 500,
          marginBottom: '28px',
        }}>
          We're building something thoughtful. Stay curious.
        </p>

        <Link
          to="/app/library"
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            borderRadius: '12px',
            background: '#6941C6',
            color: '#FFFFFF',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Back to Library
        </Link>
      </div>
    </div>
  )
}
