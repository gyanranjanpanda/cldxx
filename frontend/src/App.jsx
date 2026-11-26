import {BrowserRouter, Route, Routes} from "react-router-dom"
import Home from './pages/Home'
import { lazy, Suspense } from "react";
import useCurrentUser from './hooks/useCurrentUser'
const SharedConversation = import.meta.env.VITE_SOVEREIGN_ONLY === "true"
  ? null : lazy(() => import("./pages/SharedConversation"));
function App() {
  useCurrentUser()
 
  return (
   <BrowserRouter>
   <Routes>
    <Route path='/' element={<Home/>}/>
    {/* Guests have no session, so this route must sit outside anything that
        expects one -- Home redirects to Login when there is no user. */}
    {SharedConversation && <Route path='/shared/:token' element={<Suspense><SharedConversation /></Suspense>} />}
   </Routes>
   
   </BrowserRouter>
  )
}

export default App
