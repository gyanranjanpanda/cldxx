import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.resolve("./temp");

if (!fs.existsSync(uploadDir)) {

    fs.mkdirSync(uploadDir, {

        recursive: true

    });

}

const storage = multer.diskStorage({

    destination(req,file,cb){

        cb(null,uploadDir);

    },

    filename(req,file,cb){

        cb(

            null,

            `${Date.now()}-${file.originalname}`

        );

    }

});

// Anything here must also be handled by utils/extractText.js (or be an image,
// which goes to the vision agent instead).
const DOC_EXTENSIONS = /\.(pdf|docx|txt|md|markdown|csv|tsv|json|log|ya?ml|xml|html?)$/i;

const DOC_MIMETYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/json",
    "application/xml"
]);

const fileFilter=(req,file,cb)=>{

    const isImage = file.mimetype.startsWith("image/");
    const isText  = file.mimetype.startsWith("text/");
    const isDoc   = DOC_MIMETYPES.has(file.mimetype) ||
                    DOC_EXTENSIONS.test(file.originalname || "");

    if(isImage || isText || isDoc){

        cb(null,true);

    }

    else{

        cb(

            new Error(

                "Unsupported file type. Upload an image, PDF, Word document or text file."

            )

        );

    }

};

export default multer({

    storage,

    fileFilter,

    limits:{

        fileSize:20*1024*1024

    }

});