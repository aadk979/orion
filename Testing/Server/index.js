import { initiateServer } from "../../Packages/server/lib/Server/initiateServer.js";
import { logger } from "../../Packages/server/lib/Utils/logger.js";
import { configuration } from "./orion.config.js";

const main = async () => {
    try {
        console.clear();
        const server = await initiateServer(undefined , configuration);
        server.app.listen(configuration.app.PORT , ()=>{
            logger.info("Server is up and running")
        })
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
};

main();