class GlobalAccessPoint {
    constructor () {
        if(GlobalAccessPoint.instance){
            throw new Error("There can only be one instance of global access point!")
        }

        GlobalAccessPoint.instance = this;
    }

    setValue(name , value) {
        GlobalAccessPoint[name] = value;
        return true;
    }

    getValue(name) {
        const value = GlobalAccessPoint[name] || "NO-VALUE";
        return value;
    }

    db() {
        return GlobalAccessPoint.db;
    }

    systemConfig() {
        return GlobalAccessPoint.systemConfig;
    }
}

const globalAccessPoint = new GlobalAccessPoint();

module.exports = { globalAccessPoint };
