import { createSlice } from '@reduxjs/toolkit'
import { agentsForMode } from "../constants/agents";

// crypto.randomUUID only exists in a secure context, so a plain-http LAN build
// would throw here rather than open an incognito chat.
const newIncognitoId = () => {
  const id = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `incognito:${id}`;
};


const initialState = {
   conversations:[],
  selectedConversation:null,
  // Which agent the composer sends to. It lives here rather than inside
  // ChatInput so the sidebar's agent list can set it too.
  selectedAgent:"auto",
  // Incognito: replies still come back, nothing is written to the database.
  // The id is minted here so the agent can key its Redis memory on it and the
  // session keeps context without ever creating a Conversation row.
  incognito:false,
  incognitoId:null,
  // Sovereign: the turn is answered by a model the organisation runs itself.
  // Unlike incognito this is not about storage -- it decides which zone the
  // prompt is allowed to reach, so it is sent with every request rather than
  // being inferred from the conversation id.
  sovereign:import.meta.env.VITE_SOVEREIGN_ONLY === "true"
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

   // Opening a stored conversation is the opposite of incognito; leaving the
   // flag on would send the next reply to an ephemeral id instead of this one.
   if(action.payload){

    state.incognito   = false;
    state.incognitoId = null;

   }

  },

  setSovereign: (state,action)=>{

   state.sovereign = import.meta.env.VITE_SOVEREIGN_ONLY === "true" || Boolean(action.payload);
   if (!agentsForMode(state.sovereign).some(({ id }) => id === state.selectedAgent)) state.selectedAgent = "auto";

  },

  setSelectedAgent: (state,action)=>{

   state.selectedAgent = agentsForMode(state.sovereign).some(({ id }) => id === action.payload)
     ? action.payload : "auto";

  },

  setIncognito: (state,action)=>{

   const on = Boolean(action.payload);

   state.incognito = on;

   // A fresh id per session: reusing one would let a later incognito chat pick
   // up the previous one's Redis memory.
   state.incognitoId = on ? newIncognitoId() : null;

   // Incognito is its own blank thread in both directions -- leaving a stored
   // conversation selected would send its id to the agent and write to it.
   state.selectedConversation = null;

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

 const { conversationId, title, titleEdited } = action.payload;
 const titleFields = titleEdited === undefined ? { title } : { title, titleEdited };

 state.conversations =
 state.conversations.map((conv)=>
  conv._id === conversationId
   ? {
      ...conv,
      ...titleFields
     }
   : conv
 );

 if(
  state.selectedConversation?._id ===
  conversationId
 ){

  state.selectedConversation = {
   ...state.selectedConversation,
   ...titleFields
  };

 }

}

 
  },
})

// Action creators are generated for each case reducer function
export const {setConversations,addConversation,setSelectedConversation,setSelectedAgent,setIncognito,setSovereign,setConvTitle,removeConversation} = conversationSlice.actions

export default conversationSlice.reducer
