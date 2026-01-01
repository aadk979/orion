class OrionSystemsControl {
    constructor() {
        if (OrionSystemsControl.instance) {
            throw new Error('Only one instance of orion systems control is allowed');
        }

        OrionSystemsControl.instance = this;
    }

    async;
}
