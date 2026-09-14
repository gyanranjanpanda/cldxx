import { useEffect } from 'react'
import api from '../utils/axios'
import { useDispatch } from 'react-redux'
import { setAuthLoading, setUserData } from '../redux/user.slice'

function useCurrentUser() {
    const dispatch=useDispatch()
useEffect(()=>{
const get=async ()=>{
    try {
        const {data}=await api.get("/api/me")
       dispatch(setUserData(data.user))
    } catch (error) {
        console.log(error)
        dispatch(setAuthLoading(false))
    }
}
get()
},[])
}

export default useCurrentUser
