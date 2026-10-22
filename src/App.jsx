import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Classifier from './pages/Classifier'
import AthleteSetup from './pages/AthleteSetup'
import SetBuilder from './pages/SetBuilder'
import Groups from './pages/Groups'
import JoinGroup from './pages/JoinGroup'
import Sponsorship from './pages/Sponsorship'
import SetPassword from './pages/SetPassword'
import ProtectedRoute from './components/ProtectedRoute'
import AthleteRecords from './pages/AthleteRecords'
import TestSets from './pages/TestSets'
import RecordsEvent from './pages/RecordsEvent'
import RecordsSwim from './pages/RecordsSwim'
import TestResults from './pages/TestResults'
import Account from './pages/Account'
import Registers from './pages/Registers'
import Register from './pages/Register'

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
        <Route path="/groups" element={
          <ProtectedRoute>
            <Groups />
          </ProtectedRoute>
        } />
        <Route path="/groups/:orgId" element={
          <ProtectedRoute>
            <Groups />
          </ProtectedRoute>
        } />
        <Route path="/join/:code" element={
          <ProtectedRoute>
            <JoinGroup />
          </ProtectedRoute>
        } />
        <Route path="/sponsorship" element={
          <ProtectedRoute>
            <Sponsorship />
          </ProtectedRoute>
        } />
        <Route path="/admin/orgs" element={<Navigate to="/sponsorship" replace />} />
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
        <Route path="/test-sets/results/:protocolId" element={
          <ProtectedRoute>
            <TestResults />
          </ProtectedRoute>
        } />
        <Route path="/test-sets" element={
          <ProtectedRoute>
            <TestSets />
          </ProtectedRoute>
        } />
        <Route path="/account" element={
          <ProtectedRoute>
            <Account />
          </ProtectedRoute>
        } />
        <Route path="/registers" element={
          <ProtectedRoute>
            <Registers />
          </ProtectedRoute>
        } />
        <Route path="/registers/:registerId" element={
          <ProtectedRoute>
            <Register />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}