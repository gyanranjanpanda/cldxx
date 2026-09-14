import { createSlice } from '@reduxjs/toolkit'


const initialState = {
   conversations:[],
  selectedConversation:null
}

export const conversationSlice = createSlice({
  name: 'conversation',
  initialState,
  reducers: {
     setConversations:(state,action)=>{
   state.conversations = Array.isArray(action.payload) ? action.payload : [];

  },

  addConversation:(state,action)=>{
   if (!Array.isArray(state.conversations)) state.conversations = [];
   if (action.payload) {
     state.conversations.unshift(action.payload);
   }

  },

  setSelectedConversation: (state,action)=>{

   state.selectedConversation =action.payload;

  },
removeConversation:(state,action)=>{

 const conversationId = action.payload;

 state.conversations =
 state.conversations.filter((conv)=>
  conv._id !== conversationId
 );

 // Deleting whatever is open has to clear the selection too, otherwise the
 // message list keeps fetching a conversation that no longer exists.
 if(
  state.selectedConversation?._id ===
  conversationId
 ){

  state.selectedConversation = null;

 }

},

setConvTitle:(state,action)=>{

 const {
  conversationId,
  title
 } = action.payload;

 state.conversations =
 state.conversations.map((conv)=>
  conv._id === conversationId
   ? {
      ...conv,
      title
     }
   : conv
 );

 if(
  state.selectedConversation?._id ===
  conversationId
 ){

  state.selectedConversation = {
   ...state.selectedConversation,
   title
  };

 }

}

 
  },
})

// Action creators are generated for each case reducer function
export const {setConversations,addConversation,setSelectedConversation,setConvTitle,removeConversation} = conversationSlice.actions

export default conversationSlice.reducer