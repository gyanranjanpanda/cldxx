import { createSlice } from '@reduxjs/toolkit'


const initialState = {
   messages:[],
   isLoading:false,
   artifacts:[]
}

export const messageSlice = createSlice({
  name: 'message',
  initialState,
  reducers: {
    setMessages:(state,action)=>{
      state.messages = Array.isArray(action.payload) ? action.payload : [];
    },

    addMessage:(state,action)=>{
      if (!Array.isArray(state.messages)) state.messages = [];
      if (action.payload) {
        state.messages.push(action.payload);
      }
    },
    setIsLoading:(state,action)=>{
      state.isLoading=action.payload;
    },
    setArtifacts: (state, action) => {
      state.artifacts = Array.isArray(action.payload) ? action.payload : [];
    }
  },
})

// Action creators are generated for each case reducer function
export const {setMessages,addMessage,setIsLoading,setArtifacts} = messageSlice.actions

export default messageSlice.reducer