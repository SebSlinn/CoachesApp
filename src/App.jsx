import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Classifier from './pages/Classifier'
import AthleteSetup from './pages/AthleteSetup'
import SetBuilder from './pages/SetBuilder'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/classifier" element={
          <ProtectedRoute>
            <Classifier />
          </ProtectedRoute>
        } />
        <Route path="/athlete-setup" element={
          <ProtectedRoute>
            <AthleteSetup />
          </ProtectedRoute>
        } />
        <Route path="/set-builder" element={
          <ProtectedRoute>
            <SetBuilder />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}