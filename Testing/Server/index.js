const { intitiateServer } = require("../../Packages/server/lib/Server/initiateServer");
const { logger } = require("../../Packages/server/lib/Utils/logger");
const { generateUID } = require("../../Packages/server/lib/Utils/valueGenerator");
const { configuration } = require("./orion.config");

const __main = async () => {
    try {
        const server = await intitiateServer(undefined , configuration);
        server.app.listen(3495 , ()=>{
            logger.info("Server is up and running")
        })
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
};

__main();