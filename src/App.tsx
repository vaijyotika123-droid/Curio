import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Topics } from './pages/Topics'
import { Connect } from './pages/Connect'
import { Challenge } from './pages/Challenge'
import { Apply } from './pages/Apply'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public-only routes */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
          </Route>

          {/* Protected routes wrapped in AppLayout */}
          <Route path="/app" element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="home" element={<Home />} />
              <Route path="library" element={<Library />} />
              <Route path="topics" element={<Topics />} />
              <Route path="connect" element={<Connect />} />
              <Route path="challenge" element={<Challenge />} />
              <Route path="apply" element={<Apply />} />
              <Route index element={<Navigate to="/app/library" replace />} />
            </Route>
          </Route>

          {/* Default fallback */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App