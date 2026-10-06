import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Classifier from './pages/Classifier'
import AthleteSetup from './pages/AthleteSetup'
import SetBuilder from './pages/SetBuilder'
import Organisations from './pages/admin/Organisations'
import SetPassword from './pages/SetPassword'
import ProtectedRoute from './components/ProtectedRoute'
import AthleteRecords from './pages/AthleteRecords'
import TestSets from './pages/TestSets'
import RecordsEvent from './pages/RecordsEvent'
import RecordsSwim from './pages/RecordsSwim'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/set-password" element={<SetPassword />} />
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
        <Route path="/admin/orgs" element={
          <ProtectedRoute>
            <Organisations />
          </ProtectedRoute>
        } />
        <Route path="/athlete-records" element={
          <ProtectedRoute>
            <AthleteRecords />
            </ProtectedRoute>
          } />
        <Route path="/athlete-records/event/:event" element={
          <ProtectedRoute>
            <RecordsEvent />
          </ProtectedRoute>
        } />
        <Route path="/athlete-records/swim/:swimId" element={
          <ProtectedRoute>
            <RecordsSwim />
          </ProtectedRoute>
        } />
        <Route path="/test-sets" element={
          <ProtectedRoute>
            <TestSets />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}