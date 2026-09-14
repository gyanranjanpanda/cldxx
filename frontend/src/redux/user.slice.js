import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  userData: null,
  authLoading: true
}

export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUserData: (state, action) => {
      state.userData = action.payload
      state.authLoading = false
    },
    setAuthLoading: (state, action) => {
      state.authLoading = action.payload
    }
  },
})

// Action creators are generated for each case reducer function
export const { setUserData, setAuthLoading } = userSlice.actions

export default userSlice.reducer
