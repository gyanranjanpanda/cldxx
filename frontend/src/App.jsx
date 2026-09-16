import {BrowserRouter, Route, Routes} from "react-router-dom"
import Home from './pages/Home'
import SharedConversation from './pages/SharedConversation'
import useCurrentUser from './hooks/useCurrentUser'
function App() {
  useCurrentUser()
 
  return (
   <BrowserRouter>
   <Routes>
    <Route path='/' element={<Home/>}/>
    {/* Guests have no session, so this route must sit outside anything that
        expects one -- Home redirects to Login when there is no user. */}
    <Route path='/shared/:token' element={<SharedConversation/>}/>
   </Routes>
   
   </BrowserRouter>
  )
}

export default App
