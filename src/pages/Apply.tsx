
import { Link } from 'react-router-dom'

export function Apply() {
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
          ◈
        </div>

        <h1 style={{
          fontSize: '32px',
          fontWeight: 700,
          color: '#211B35',
          marginBottom: '16px',
        }}>
          Turn knowledge into action
        </h1>

        <p style={{
          color: '#777085',
          fontSize: '16px',
          lineHeight: 1.8,
          marginBottom: '28px',
        }}>
          Learning becomes more powerful when you put it
          into practice. Soon, you'll be able to experiment
          with ideas, apply concepts to real situations,
          and turn insights into meaningful action.
        </p>

        <p style={{
          color: '#6941C6',
          fontSize: '14px',
          fontWeight: 500,
          marginBottom: '28px',
        }}>
          Your next chapter of learning is on its way.
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
